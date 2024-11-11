/** This whole module kinda sucks */
import fs from "fs";
import express, { Router, Request, Response } from "express";
import showdown from "showdown";
import { config } from "./config";
import { buildInfo, ServiceInfo } from "./service-info";
import { getLastNImages } from "./shared/file-storage/image-history";
import { keyPool } from "./shared/key-management";
import { MODEL_FAMILY_SERVICE, ModelFamily } from "./shared/models";
import { withSession } from "./shared/with-session";
import { checkCsrfToken, injectCsrfToken } from "./shared/inject-csrf";

const INFO_PAGE_TTL = 2000;
const converter = new showdown.Converter();
let infoPageHtml: string | undefined;
let infoPageLastUpdated = 0;

export const handleInfoPage = (req: Request, res: Response) => {
  if (infoPageLastUpdated + INFO_PAGE_TTL > Date.now(}} {
    return res.send(infoPageHtml);
  }
  const baseUrl =
    process.env.SPACE_ID && !req.get("host")?.includes("hf.space")
      ? getExternalUrlForHuggingfaceSpaceId(process.env.SPACE_ID)
      : req.protocol + "://" + req.get("host");
  const info = buildInfo(baseUrl + config.proxyEndpointRoute);
  infoPageHtml = renderPage(info);
  infoPageLastUpdated = Date.now();
  res.send(infoPageHtml);
};

export function renderPage(info: ServiceInfo) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <title>Service Information Restricted</title>
    <link rel="stylesheet" href="/res/css/reset.css" media="screen" />
    <link rel="stylesheet" href="/res/css/sakura.css" media="screen" />
    <link rel="stylesheet" href="/res/css/sakura-dark.css" media="screen and (prefers-color-scheme: dark)" />
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
        text-align: center;
      }
      .restricted-message {
        max-width: 600px;
        padding: 20px;
        background: rgba(255,255,255,0.1);
        border-radius: 10px;
      }
    </style>
  </head>
  <body>
    <div class="restricted-message">
      <h1>Service Information Restricted</h1>
      <p>Access to service details is currently unavailable.</p>
    </div>
  </body>
</html>`;
}

function getExternalUrlForHuggingfaceSpaceId(spaceId: string) {
  try {
    const [username, spacename] = spaceId.split("/");
    return `https://${username}-${spacename.replace(/_/g, "-")}.hf.space`;
  } catch (e) {
    return "";
  }
}

function checkIfUnlocked(
  req: Request,
  res: Response,
  next: express.NextFunction
) {
  if (config.serviceInfoPassword?.length && !req.session?.unlocked) {
    return res.redirect("/unlock-info");
  }
  next();
}

const infoPageRouter = Router();
if (config.serviceInfoPassword?.length) {
  infoPageRouter.use(
    express.json({ limit: "1mb" }),
    express.urlencoded({ extended: true, limit: "1mb" })
  );
  infoPageRouter.use(withSession);
  infoPageRouter.use(injectCsrfToken, checkCsrfToken);
  infoPageRouter.post("/unlock-info", (req, res) => {
    if (req.body.password !== config.serviceInfoPassword) {
      return res.status(403).send("Incorrect password");
    }
    req.session!.unlocked = true;
    res.redirect("/");
  });
  infoPageRouter.get("/unlock-info", (_req, res) => {
    if (_req.session?.unlocked) return res.redirect("/");
    res.send(`
      <form method="post" action="/unlock-info">
        <h1>Unlock Service Info</h1>
        <input type="hidden" name="_csrf" value="${res.locals.csrfToken}" />
        <input type="password" name="password" placeholder="Password" />
        <button type="submit">Unlock</button>
      </form>
    `);
  });
  infoPageRouter.use(checkIfUnlocked);
}
infoPageRouter.get("/", handleInfoPage);
infoPageRouter.get("/status", (req, res) => {
  res.json(buildInfo(req.protocol + "://" + req.get("host"), false}};
});

export { infoPageRouter };
