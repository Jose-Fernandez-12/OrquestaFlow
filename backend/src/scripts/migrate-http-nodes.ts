import { getDb, initDb } from "../db/database.js";

async function migrate() {
  await initDb();
  const db = getDb();
  const flows = db.prepare("SELECT * FROM flows").all() as any[];
  
  for (const flow of flows) {
    if (!flow.definition) continue;
    let modified = false;
    let def;
    try {
      def = JSON.parse(flow.definition);
    } catch (e) {
      continue;
    }
    
    for (const node of def.nodes || []) {
      if (node.type === "httpGet" || node.type === "httpPost") {
        node.data.method = node.type === "httpPost" ? "POST" : "GET";
        node.type = "httpRequest";
        modified = true;
      }
    }
    
    if (modified) {
      db.prepare("UPDATE flows SET definition = ? WHERE id = ?").run(JSON.stringify(def), flow.id);
      console.log(`Migrated flow: ${flow.id}`);
    }
  }
  console.log("Migration complete.");
}

migrate();
