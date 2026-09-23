"""Static checks: regexes (read from stdin) against Edge's RE2 settings, plus manifest and policy schema."""
import json, os, sys

failures = []

# Chromium compiles DNR regexes with RE2: Latin-1, no captures, 2 KB max_mem (case-insensitive by default).
try:
    import re2
    opts = re2.Options()
    opts.encoding, opts.case_sensitive, opts.never_capture, opts.log_errors, opts.max_mem = \
        re2.Options.Encoding.LATIN1, False, True, False, 2 << 10
    regexes = [line.rstrip('\n') for line in sys.stdin if line.strip()]
    for rx in regexes:
        try:
            re2.compile(rx.encode('latin1'), opts)
        except Exception as e:
            failures.append(f'regex rejected by RE2 ({e}): {rx}')
    print(f'RE2: checked {len(regexes)} regexes')
except ImportError:
    print('RE2: skipped (pip install google-re2 to check regex size limits)')

manifest = json.load(open('manifest.json'))
files = list(manifest['icons'].values()) + list(manifest['action']['default_icon'].values()) + [
    manifest['action']['default_popup'], manifest['options_ui']['page'],
    manifest['background']['service_worker'], manifest['storage']['managed_schema']]
files += [f'icons/icon-off-{s}.png' for s in (16, 32, 48, 128)]
for f in files:
    if not os.path.isfile(f):
        failures.append(f'missing file referenced by manifest: {f}')
if manifest.get('host_permissions') != [f'https://{h}/*' for h in ('login.microsoftonline.com', 'login.microsoft.com', 'login.windows.net', 'sts.windows.net')]:
    failures.append('manifest host_permissions must match ENTRA_HOSTS in src/rules.js')
if manifest.get('incognito') != 'not_allowed':
    failures.append('manifest must keep incognito "not_allowed" (the extension must not run in InPrivate)')
csp = manifest.get('content_security_policy', {}).get('extension_pages', '')
if "default-src 'none'" not in csp or "script-src 'self'" not in csp:
    failures.append('manifest extension_pages CSP must stay strict')
if manifest.get('web_accessible_resources') or manifest.get('content_scripts') or manifest.get('externally_connectable'):
    failures.append('no web_accessible_resources, content_scripts or externally_connectable')
if len(manifest['description']) > 132:
    failures.append('manifest description is over 132 characters')

# Chromium's managed-storage schema rules; an invalid schema stops the extension from loading.
TYPES = {'object', 'array', 'string', 'boolean', 'integer', 'number'}
def check_schema(node, path, root=False):
    if not isinstance(node.get('type'), str) or node['type'] not in TYPES:
        failures.append(f'schema {path}: needs a single valid "type"')
        return
    for key in ('title', 'description'):
        if key in node and not isinstance(node[key], str):
            failures.append(f'schema {path}: {key} must be a string')
    if root and (node['type'] != 'object' or 'additionalProperties' in node or 'patternProperties' in node):
        failures.append('schema root must be a plain object')
    if node['type'] == 'array':
        if 'items' not in node:
            failures.append(f'schema {path}: arrays need "items"')
        else:
            check_schema(node['items'], path + '[]')
    if 'enum' in node and (node['type'] not in ('string', 'integer') or not all(isinstance(v, str if node['type'] == 'string' else int) for v in node['enum'])):
        failures.append(f'schema {path}: bad enum')
    for name, child in node.get('properties', {}).items():
        check_schema(child, f'{path}.{name}')
check_schema(json.load(open('schema.json')), '$', root=True)

# Every policy the schema offers must be a setting the code has a default for.
settings_js = open('src/settings.js').read()
for name in json.load(open('schema.json'))['properties']:
    if f'{name}:' not in settings_js:
        failures.append(f'schema policy {name} has no default in src/settings.js')

for f in failures:
    print('FAIL', f)
print('Static checks:', 'FAILED' if failures else 'ok')
sys.exit(1 if failures else 0)
