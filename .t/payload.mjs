/**
 * Combien pèse une requête de l'assistant Tableur, et de quoi est fait ce poids ?
 * Un prompt énorme explique une réponse lente même chez un fournisseur rapide.
 */
const tools = await import('../src/spreadsheet/src/core/aitools.js');
const agent = await import('../src/spreadsheet/src/core/aiagent.js');

const schema = JSON.stringify(tools.TOOLS);
const prompt = agent.systemPrompt();
console.log(`schéma d'outils : ${tools.TOOLS.length} outils, ${(schema.length / 1024).toFixed(1)} Ko`);
console.log(`prompt système  : ${(prompt.length / 1024).toFixed(1)} Ko`);
const total = schema.length + prompt.length;
console.log(`envoyé à chaque tour : ${(total / 1024).toFixed(1)} Ko (~${Math.round(total / 4)} jetons)`);

// Les cinq outils les plus lourds : ce sont eux qui pèsent dans le prompt.
const weights = tools.TOOLS
  .map((t) => ({ name: t.function.name, size: JSON.stringify(t).length }))
  .sort((a, b) => b.size - a.size);
console.log('les plus lourds :', weights.slice(0, 5).map((w) => `${w.name} ${(w.size / 1024).toFixed(1)} Ko`).join(', '));
