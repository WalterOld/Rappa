import express, { Router, Request, Response } from "express";

const INFO_PAGE_TTL = 2000;
let infoPageHtml: string | undefined;
let infoPageLastUpdated = 0;

export const handleInfoPage = (_req: Request, res: Response) => {
  if (infoPageLastUpdated + INFO_PAGE_TTL > Date.now(}} {
    return res.send(infoPageHtml);
  }
  infoPageHtml = renderPage();
  infoPageLastUpdated = Date.now();
  res.send(infoPageHtml);
};

export function renderPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <title>Service Info</title>
    <style>
      body {
        background-color: black;
        color: white;
        font-family: sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <h1>Service information is currently unavailable.</h1>
  </body>
</html>`;
}

function checkIfUnlocked(
  _req: Request,
  res: Response,
  next: express.NextFunction
) {
  next();
}

const infoPageRouter = Router();
infoPageRouter.use(checkIfUnlocked);
infoPageRouter.get("/", handleInfoPage);
infoPageRouter.get("/status", (_req, res) => {
  res.status(404).send("Not Found");
});

export { infoPageRouter };
