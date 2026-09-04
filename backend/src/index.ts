import "dotenv/config";
import express from "express";
import cors from "cors";
import { deliveriesRouter } from "./routes/deliveries";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/deliveries", deliveriesRouter);

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
