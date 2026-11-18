import { snapshot, subscribe } from './store.js';

export function handleStream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const send = (snap) => {
    res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);
  };

  send(snapshot());

  let dirty = null;
  const unsubscribe = subscribe((snap) => {
    dirty = snap;
  });

  const timer = setInterval(() => {
    if (dirty) {
      send(dirty);
      dirty = null;
    } else {
      res.write(': keep-alive\n\n');
    }
  }, 500);

  const cleanup = () => {
    clearInterval(timer);
    unsubscribe();
  };

  req.on('close', cleanup);
  req.on('error', cleanup);

  return true;
}