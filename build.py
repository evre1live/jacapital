# Сборка интерфейса: client/*.js + client/app.css → public/index.html
import pathlib
root = pathlib.Path(__file__).parent
page = (root/'client/page.html').read_text()
css = (root/'client/app.css').read_text()
js = '\n'.join((root/'client'/f).read_text() for f in ['live.js','scene.js','scene3d.js','theme.js','live-scene.js','ui-live.js','office-live.js'])
assert '/*CSS*/' in page and '/*APP*/' in page
(root/'public/index.html').write_text(page.replace('/*CSS*/', css).replace('/*APP*/', js))
print('public/index.html', len(page)+len(css)+len(js), 'байт')
