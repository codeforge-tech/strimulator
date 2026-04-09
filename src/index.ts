import { createApp } from "./app";
import { createDB } from "./db";
import { config } from "./config";

const db = createDB(config.dbPath);
const app = createApp(db);

app.listen(config.port, () => {
  console.log(`Strimulator running on http://localhost:${config.port}`);
});
