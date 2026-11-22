// Node ne sait pas charger un .png : on le remplace par une chaîne, comme le
// fait Vite. Sert aux modules d'interface qui importent des images.
export async function load(url, context, next) {
  if (/\.(png|jpe?g|svg|webp|gif|woff2?)$/.test(url)) {
    return { format: 'module', shortCircuit: true, source: 'export default ""' };
  }
  return next(url, context);
}
