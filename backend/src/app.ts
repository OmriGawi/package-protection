import express from "express";
import cors from "cors";
import { deliveriesRouter } from "./routes/deliveries";
import { imagesRouter } from "./routes/images";

export const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/deliveries", deliveriesRouter);
app.use("/api/images", imagesRouter);
