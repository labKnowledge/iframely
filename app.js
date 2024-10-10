import { fileURLToPath } from "url";
import path, { dirname } from "path";
import fs from "fs/promises";
import express from "express";
import * as jsonxml from "jsontoxml";

import { cacheMiddleware, NotFound } from "./utils.js";
import CONFIG from "./config.loader.js";
global.CONFIG = CONFIG;

console.log("");
console.log("Starting Iframely...");
console.log(
  "Base URL for embeds that require hosted renders:",
  CONFIG.baseAppUrl
);

if (!CONFIG.baseAppUrl) {
  console.warn("Warning: CONFIG.baseAppUrl not set, default value used");
}

const app = express();

export default app;

app.set("view engine", "ejs");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (CONFIG.allowedOrigins) {
  app.use(function (req, res, next) {
    var origin = req.headers["origin"];

    if (origin) {
      if (CONFIG.allowedOrigins.indexOf("*") > -1) {
        res.setHeader("Access-Control-Allow-Origin", "*");
      } else {
        if (CONFIG.allowedOrigins.indexOf(origin) > -1) {
          res.setHeader("Access-Control-Allow-Origin", origin);
        }
      }
    }
    next();
  });
}
app.disable("x-powered-by");
app.use(function (req, res, next) {
  res.setHeader("X-Powered-By", "Iframely");
  next();
});

app.use(cacheMiddleware);

import apiViews from "./modules/api/views.js";
import debugViews from "./modules/debug/views.js";
apiViews(app);
debugViews(app);

if (CONFIG.tests) {
  const testViews = await import("./modules/tests-ui/views.js");
  testViews.default(app);
}

app.use(logErrors);
app.use(errorHandler);

function logErrors(err, req, res, next) {
  if (CONFIG.RICH_LOG_ENABLED) {
    console.error(err.stack);
  } else {
    console.log(err.message);
  }

  next(err);
}

function respondWithError(req, res, code, msg, messages) {
  var err = {
    error: {
      source: "iframely",
      code: code,
      message: msg,
    },
  };

  if (messages) {
    err.error.messages = messages;
  }

  var ttl;
  if (code === 404) {
    ttl = CONFIG.CACHE_TTL_PAGE_404;
  } else if (code === 408) {
    ttl = CONFIG.CACHE_TTL_PAGE_TIMEOUT;
  } else {
    ttl = CONFIG.CACHE_TTL_PAGE_OTHER_ERROR;
  }

  if (req.query.format === "xml") {
    var xmlError = jsonxml(err, {
      escape: true,
      xmlHeader: {
        standalone: true,
      },
    });

    res.sendCached("text/xml", xmlError, {
      code: code,
      ttl: ttl,
    });
  } else {
    res.sendJsonCached(err, {
      code: code,
      ttl: ttl,
    });
  }
}

var proxyErrorCodes = [401, 403, 408];

function errorHandler(err, req, res, next) {
  if (err instanceof NotFound) {
    respondWithError(req, res, 404, err.message, err.messages);
  } else {
    var code = err.code || 500;
    proxyErrorCodes.map(function (e) {
      if (err.message.indexOf(e) > -1) {
        code = e;
      }
    });

    var message = "Server error";

    if (code === 400) {
      message = (err.message && "Bad Request: " + err.message) || "Bad Request";
    } else if (code === 401) {
      message = "Unauthorized";
      // Force 403 to prevent Basic auth popup.
      code = 403;
    } else if (code === 403) {
      message = "Forbidden";
    } else if (code === 404) {
      message = "Not found";
    } else if (code === 408) {
      message = "Timeout";
    } else if (code === 410) {
      message = "Gone";
    } else if (code === 415 || code === 417) {
      message = err.message || "Unsupported Media Type";
    }

    respondWithError(req, res, code, message, err.messages);
  }
}

process.on("uncaughtException", function (err) {
  if (CONFIG.DEBUG) {
    console.log(err.stack);
  } else {
    console.log(err.message);
  }
});

if (process.env.NODE_ENV !== "test") {
  // This code not compatible with 'supertest' (in e2e.js)
  // Disabled for tests.
  app.use(CONFIG.relativeStaticUrl, express.static("static"));
}

app.get("/", function (req, res) {
  res.writeHead(302, { Location: "http://eligapris.com" });
  res.end();
});

const FILES_DIRECTORY = path.join(__dirname, "public");

app.get("/files/:filename", async (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(FILES_DIRECTORY, filename);

  try {
    // Check if file exists
    await fs.access(filePath);

    // Determine MIME type (you might want to expand this list)
    const ext = filename.split(".").pop().toLowerCase();
    const mimeTypes = {
      js: "application/javascript",
      css: "text/css",
      html: "text/html",
      json: "application/json",
      txt: "text/plain"
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";

    // Set the content type and send the file
    res.contentType(contentType);
    res.sendFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.status(404).send("File not found");
    } else {
      console.error("Error serving file:", error);
      res.status(500).send("Internal server error");
    }
  }
});

process.title = "eligapris";
