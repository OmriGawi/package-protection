import express from "express";
import cors from "cors";
import { deliveriesRouter } from "./routes/deliveries";

export const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/deliveries", deliveriesRouter);
