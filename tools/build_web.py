"""Genera index.html (versión web independiente con Firebase) a partir de la versión Artifact."""
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()
head, rest = s.split('<header class="top">', 1)
headpart = head[:head.index('</style>') + len('</style>')]
extra_css = '''
<style>
#login{min-height:100vh;display:grid;place-items:center;padding:16px}
#login .card{max-width:380px;width:100%;display:grid;gap:14px;text-align:center}
#login h1{font-family:var(--display);font-size:30px;margin:0}
</style>'''
i = rest.index('<script src="https://cdnjs')
markup, scripts = rest[:i], rest[i:]
fb = open(__file__.replace('build_web.py', 'firebase_glue.html')).read()
login = open(__file__.replace('build_web.py', 'login.html')).read()
markup = markup.replace('<label class="mon" for="moneda">', '<span class="mon"><span id="who"></span> <button class="btn sm ghost" id="logoutBtn" type="button">Salir</button></span>\n      <label class="mon" for="moneda">', 1)
out = ('<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
       + headpart + extra_css + '\n</head>\n<body>\n' + login + '<div id="app" hidden>\n<header class="top">'
       + markup.rstrip() + '\n</div>\n' + fb + scripts + '\n</body>\n</html>\n')
out = out.replace("No se pueden cargar ni guardar datos en esta vista. Abre el sistema desde tu cuenta de Claude para usarlo.",
                  "No se pudo conectar con la base de datos. Revisa tu internet y recarga la página.")
open(dst, 'w').write(out)
