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
const MODEL_FAMILY_FRIENDLY_NAME: { [f in ModelFamily]: string } = {
  turbo: "GPT-4o Mini / 3.5 Turbo",
  gpt4: "GPT-4",
  "gpt4-32k": "GPT-4 32k",
  "gpt4-turbo": "GPT-4 Turbo",
  gpt4o: "GPT-4o",
  o1: "OpenAI o1",
  "o1-mini": "OpenAI o1 mini",
  "dall-e": "DALL-E",
  claude: "Claude (Sonnet)",
  "claude-opus": "Claude (Opus)",
  "gemini-flash": "Gemini Flash",
  "gemini-pro": "Gemini Pro",
  "gemini-ultra": "Gemini Ultra",
  "mistral-tiny": "Mistral 7B",
  "mistral-small": "Mistral Nemo",
  "mistral-medium": "Mistral Medium",
  "mistral-large": "Mistral Large",
  "aws-claude": "AWS Claude (Sonnet)",
  "aws-claude-opus": "AWS Claude (Opus)",
  "aws-mistral-tiny": "AWS Mistral 7B",
  "aws-mistral-small": "AWS Mistral Nemo",
  "aws-mistral-medium": "AWS Mistral Medium",
  "aws-mistral-large": "AWS Mistral Large",
  "gcp-claude": "GCP Claude (Sonnet)",
  "gcp-claude-opus": "GCP Claude (Opus)",
  "azure-turbo": "Azure GPT-3.5 Turbo",
  "azure-gpt4": "Azure GPT-4",
  "azure-gpt4-32k": "Azure GPT-4 32k",
  "azure-gpt4-turbo": "Azure GPT-4 Turbo",
  "azure-gpt4o": "Azure GPT-4o",
  "azure-o1": "Azure o1",
  "azure-o1-mini": "Azure o1 mini",
  "azure-dall-e": "Azure DALL-E",
};
const converter = new showdown.Converter();
const customGreeting = fs.existsSync("greeting.md")
  ? `<div id="servergreeting">${fs.readFileSync("greeting.md", "utf8")}</div>`
  : "";
let infoPageHtml: string | undefined;
let infoPageLastUpdated = 0;
export const handleInfoPage = (req: Request, res: Response) => {
  if (infoPageLastUpdated + INFO_PAGE_TTL > Date.now()) {
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
