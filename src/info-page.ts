import express, { Router, Request, Response } from "express";
import { withSession } from "./shared/with-session";
import { checkCsrfToken, injectCsrfToken } from "./shared/inject-csrf";

const infoPageRouter = Router();

infoPageRouter.use(withSession);
infoPageRouter.use(injectCsrfToken, checkCsrfToken);

infoPageRouter.get("/", (_req: Request, res: Response) => {
  res.send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="robots" content="noindex" />
        <title>Service Unavailable</title>
        <style>
          body {
            background-color: black;
            color: white;
            font-family: sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
          }
          .message {
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="message">
          <h1>Service Information Unavailable</h1>
          <p>We apologize for the inconvenience.</p>
        </div>
      </body>
    </html>
  `);
});

infoPageRouter.get("/status", (_req: Request, res: Response) => {
  res.status(503).json({ message: "Service information unavailable" });
});

export { infoPageRouter };
