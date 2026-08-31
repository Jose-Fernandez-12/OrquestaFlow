(async () => {
  try {
    const res = await fetch('http://localhost:3001/api/flows');
    const flows = await res.json();
    for (const flow of flows.data) {
      if (!flow.definition) continue;
      const def = JSON.parse(flow.definition);
      let modified = false;
      for (const node of def.nodes || []) {
        if (node.type === 'httpGet' || node.type === 'httpPost') {
          node.data.method = node.type === 'httpPost' ? 'POST' : 'GET';
          node.type = 'httpRequest';
          modified = true;
        }
      }
      if (modified) {
        flow.definition = JSON.stringify(def);
        await fetch('http://localhost:3001/api/flows/' + flow.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: flow.name, definition: flow.definition })
        });
        console.log('Migrated flow: ' + flow.id);
      }
    }
    console.log('Done');
  } catch(e) {
    console.error(e);
  }
})();
