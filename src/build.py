import pathlib
d=pathlib.Path(__file__).parent
t=(d/'template.html').read_text()
for k,f in (('SIM','sim.js'),('SHADERS','shaders.js'),('APP','app.js')):
    t=t.replace('/*__%s__*/'%k,(d/f).read_text())
out=d.parent/'melon-jelly.html'
out.write_text(t)
(d.parent/'index.html').write_text(t)   # GitHub Pages entry point
print(out, len(t)//1024,'KB')
