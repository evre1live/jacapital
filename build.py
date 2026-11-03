# Сборка интерфейса: client/*.js → public/index.html
import pathlib
root = pathlib.Path(__file__).parent
page = (root/'client/page.html').read_text()
js = '\n'.join((root/'client'/f).read_text() for f in ['live.js','scene.js','live-scene.js','ui-live.js','office-live.js'])
(root/'public/index.html').write_text(page.replace('/*APP*/', js))
print('public/index.html', len(page)+len(js), 'байт')
