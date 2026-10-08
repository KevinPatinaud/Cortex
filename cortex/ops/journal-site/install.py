"""Install the archive UI without editing editions, Cortex projects or mail jobs."""
import argparse
import datetime
import pathlib
import shutil
import subprocess
import tempfile

SOURCE = pathlib.Path(__file__).resolve().parent / 'site'
FILES = ('journal.php', 'site.css', 'favicon.svg', 'index.php', '.htaccess')
BEGIN = '# BEGIN cortex-journal-site'
END = '# END cortex-journal-site'


def install(web_root, backup_root):
    target = pathlib.Path(web_root).resolve(strict=True)
    if not target.is_dir() or target == pathlib.Path(target.anchor):
        raise RuntimeError('Le dossier de publication doit déjà exister.')
    for name in ('journal.php', 'index.php'):
        subprocess.run(['php', '-l', str(SOURCE / name)], check=True)
    existing_rules = (target / '.htaccess').read_text() if (target / '.htaccess').exists() else ''
    if BEGIN in existing_rules:
        before, managed = existing_rules.split(BEGIN, 1)
        if END not in managed:
            raise RuntimeError('Bloc de configuration incomplet : installation interrompue.')
        _, after = managed.split(END, 1)
        existing_rules = before.rstrip() + '\n' + after.lstrip('\n')
    rules = existing_rules.rstrip() + '\n' + BEGIN + '\n' + (SOURCE / '.htaccess').read_text() + END + '\n'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = pathlib.Path(backup_root).resolve() / stamp
    backup.mkdir(parents=True, exist_ok=False)
    absent = []
    for name in FILES:
        path = target / name
        if path.is_symlink():
            raise RuntimeError(f'Fichier de site lié symboliquement : {name}.')
        if path.exists():
            shutil.copy2(path, backup / name)
        else:
            absent.append(name)
    (backup / 'absent.txt').write_text('\n'.join(absent) + '\n')
    installed = []
    try:
        for name in FILES:
            with tempfile.NamedTemporaryFile(dir=target, prefix='.journal-site-', delete=False) as temporary:
                stage = pathlib.Path(temporary.name)
                temporary.write(rules.encode() if name == '.htaccess' else (SOURCE / name).read_bytes())
            try:
                stage.chmod(0o644)
                stage.replace(target / name)
                installed.append(name)
            finally:
                stage.unlink(missing_ok=True)
    except Exception:
        for name in reversed(installed):
            saved = backup / name
            if saved.exists():
                shutil.copy2(saved, target / name)
            elif name in absent:
                (target / name).unlink(missing_ok=True)
        raise
    print(f'Site installé : {target}\nSauvegarde : {backup}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--web-root', default='/var/www/KevinPatinaud/journal')
    parser.add_argument('--backup-root', default='/home/kevin/Cortex/cortex/data/backups/journal-site')
    options = parser.parse_args()
    install(options.web_root, options.backup_root)
