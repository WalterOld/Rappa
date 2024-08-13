import { Request } from "express";
import {
  createOnProxyResHandler,
  ProxyResHandlerWithBody,
} from "./middleware/response";
import { createQueueMiddleware } from "./queue";
import {
  createOnProxyReqHandler,
  createPreprocessorMiddleware,
  finalizeSignedRequest,
  signAwsRequest,
} from "./middleware/request";
import { createProxyMiddleware } from "http-proxy-middleware";
import { logger } from "../logger";
import { handleProxyError } from "./middleware/common";
import { Router } from "express";
import { ipLimiter } from "./rate-limit";

const awsMistralBlockingResponseHandler: ProxyResHandlerWithBody = async (
  _proxyRes,
  req,
  res,
  body
) => {
  if (typeof body !== "object") {
    throw new Error("Expected body to be an object");
  }

  // AWS does not always confirm the model in the response, so we have to add it
  if (!body.model && req.body.model) {
    body.model = req.body.model;
  }

  res.status(200).json({ ...body, proxy: body.proxy });
};

const awsMistralProxy = createQueueMiddleware({
  beforeProxy: signAwsRequest,
  proxyMiddleware: createProxyMiddleware({
    target: "bad-target-will-be-rewritten",
    router: ({ signedRequest }) => {
      if (!signedRequest) throw new Error("Must sign request before proxying");
      return `${signedRequest.protocol}//${signedRequest.hostname}`;
    },
    changeOrigin: true,
    selfHandleResponse: true,
    logger,
    on: {
      proxyReq: createOnProxyReqHandler({ pipeline: [finalizeSignedRequest] }),
      proxyRes: createOnProxyResHandler([awsMistralBlockingResponseHandler]),
      error: handleProxyError,
    },
  }),
});

function maybeReassignModel(req: Request) {
  const model = req.body.model;

  // If it looks like an AWS model, use it as-is
  if (model.startsWith("mistral.")) {
    return;
  }
  // Mistral 7B Instruct
  else if (model.includes("7b")) {
    req.body.model = "mistral.mistral-7b-instruct-v0:2";
  }
  // Mistral 8x7B Instruct
  else if (model.includes("8x7b")) {
    req.body.model = "mistral.mixtral-8x7b-instruct-v0:1";
  }
  // Mistral Large (Feb 2024)
  else if (model.includes("large-2402")) {
    req.body.model = "mistral.mistral-large-2402-v1:0";
  }
  // Mistral Large 2 (July 2024)
  else if (model.includes("large")) {
    req.body.model = "mistral.mistral-large-2407-v1:0";
  }
  // Mistral Small (Feb 2024)
  else if (model.includes("small")) {
    req.body.model = "mistral.mistral-small-2402-v1:0";
  } else {
    throw new Error(`Can't map '${model}' to a supported AWS model ID; make sure you are requesting a Mistral model supported by Amazon Bedrock`);
  }
}

const nativeMistralChatPreprocessor = createPreprocessorMiddleware(
  { inApi: "mistral-ai", outApi: "mistral-ai", service: "aws" },
  { afterTransform: [maybeReassignModel] }
);

const awsMistralRouter = Router();
awsMistralRouter.post(
  "/v1/chat/completions",
  ipLimiter,
  nativeMistralChatPreprocessor,
  awsMistralProxy
);

export const awsMistral = awsMistralRouter;