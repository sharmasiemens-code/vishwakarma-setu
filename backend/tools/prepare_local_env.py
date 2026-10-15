"""Create missing local signing keys without printing values or replacing files."""
import os
from pathlib import Path
import secrets
from dotenv import dotenv_values

path = Path(__file__).resolve().parents[1] / '.env'
if path.is_symlink():
    raise SystemExit('Refusing to modify a linked .env file. Configure its target manually.')
existing = dotenv_values(path) if path.exists() else {}
entries = []
if 'DATABASE_URL' not in existing:
    entries.append(('DATABASE_URL', ''))
for name in ('JWT_SECRET_KEY', 'START_PIN_HMAC_SECRET', 'HAPPY_CODE_HMAC_SECRET'):
    if name not in existing and not os.environ.get(name):
        entries.append((name, secrets.token_urlsafe(48)))
if entries:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(descriptor, 'a', encoding='utf-8') as output:
        output.write('\n# Local development configuration; never commit this file.\n')
        for name, value in entries:
            output.write(f'{name}={value}\n')
    print('Added configuration entries: ' + ', '.join(name for name, _ in entries))
else:
    print('Existing configuration preserved.')
print('Set DATABASE_URL in backend/.env. Existing blank values need manual completion. No secret values were printed.')
