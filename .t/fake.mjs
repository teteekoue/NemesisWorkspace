// Faux fournisseur OpenAI v1 : enregistre chaque requête, répond un flux SSE
// qui contient un appel d'outil (en morceaux) puis du texte.
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const log = [];

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fake-gpt' }, { id: 'fake-vision' }] }));
      return;
    }
    const parsed = JSON.parse(body || '{}');
    log.push({ url: req.url, auth: req.headers.authorization, body: parsed });
    writeFileSync('/home/user/NemesisWorkspace/.t/requests.json', JSON.stringify(log, null, 2));

    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'edit_document', arguments: '{"act' } }] } }] });
    send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ion":"insert","text":"Bonjour"}' } }] } }] });
    send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    send({ choices: [{ delta: { content: 'Voici le plan.' } }] });
    send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    send({ usage: { prompt_tokens: 10, completion_tokens: 5 } });
    res.write('data: [DONE]\n\n');
    res.end();
  });
});

server.listen(4310, '127.0.0.1', () => console.log('faux fournisseur sur http://127.0.0.1:4310/v1'));
