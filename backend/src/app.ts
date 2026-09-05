import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./lib/config";
import { deliveriesRouter } from "./routes/deliveries";
import { healthRouter } from "./routes/health";
import { imagesRouter } from "./routes/images";
import { packagesRouter } from "./routes/packages";
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";
import { globalLimiter } from "./middleware/rateLimit";
import { requestId } from "./middleware/requestId";

export const app = express();

// Decides what req.ip is, which decides what the rate limiter counts. Behind an
// ingress with this left at Express's default, every caller reports the
// ingress's own address and the whole deployment shares one bucket
// (config.ts explains the shape).
app.set("trust proxy", config.trustProxy);

// Order matters, and this is the order:
//   headers → origin → identity of the request → volume → body → routes.
app.use(
  helmet({
    // helmet's same-origin default blocks every <img> the SPA loads: the
    // frontend is served from a different port in development and may be a
    // different host in production, and GET /api/images/:id is the whole
    // point of the photos.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// An explicit origin list in production, anything in development. A wildcard
// also stops working the moment auth uses cookies (DESIGN.md §6).
app.use(cors(config.corsOrigins.length > 0 ? { origin: config.corsOrigins } : {}));

app.use(requestId);

// Ahead of the limiter as well as the routers: a probe has to stay answerable
// when the rest of the API is refusing traffic, or a burst of requests takes
// the instance out of rotation instead of just being throttled.
app.use("/api", healthRouter);

// Photos are also outside the global limiter, and for the same reason: one
// package detail page loads eight thumbnails at once and re-polls while a check
// runs, so a per-address request budget would be spent on <img> tags rather than
// on anything worth limiting. A 429 into an <img> renders as a broken
// thumbnail, which reads as lost evidence.
app.use("/api/images", imagesRouter);

app.use(globalLimiter);
app.use(express.json({ limit: config.jsonBodyLimit }));

app.use("/api/deliveries", deliveriesRouter);
app.use("/api/packages", packagesRouter);

app.use(notFound);
app.use(errorHandler);
