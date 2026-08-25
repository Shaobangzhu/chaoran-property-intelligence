import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildWildfireHazardArtifact,
  createWildfireHazardManifest,
  serializeManifest,
} from "./artifact.mjs";
import {
  createBoundaryClip,
  resolveCoverageTargetBoundary,
  validateBuildConfig,
} from "./pipelineConfig.mjs";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolDirectory, "../..");
const cacheRoot = join(repositoryRoot, ".cache/wildfire-hazard");
const sourceDirectory = join(cacheRoot, "sources");
const workDirectory = join(cacheRoot, "work");
const intermediateDirectory = join(workDirectory, "intermediate");
const stagingDirectory = join(cacheRoot, "staged");
const outputDirectory = join(
  repositoryRoot,
  "apps/web/public/data/wildfire-hazard",
);

const config = JSON.parse(
  await readFile(new URL("./config.json", import.meta.url), "utf8"),
);
const buildOptions = parseBuildOptions(process.argv.slice(2));

await main(buildOptions);

async function main(options) {
  const { sourcesById } = validateBuildConfig(config);
  if (options.mode === "publish" && !config.publication.enabled) {
    throw new Error(
      `Wildfire publication is locked until Block ${config.publication.blockedUntilBlock}. ` +
        "Use pnpm wildfire:data:stage for an offline candidate build.",
    );
  }
  assertPinnedNodeVersion();

  await mkdir(sourceDirectory, { recursive: true });
  await rm(workDirectory, { recursive: true, force: true });
  await mkdir(intermediateDirectory, { recursive: true });

  console.log("Preparing checksum-pinned official sources...");
  const sourceFiles = new Map();
  for (const source of config.sources) {
    sourceFiles.set(source.id, await prepareSource(source, options));
  }

  const boundaryCollections = new Map();
  for (const target of config.coverageTargets) {
    const boundarySource = sourcesById.get(target.boundarySourceId);
    let boundaryCollection = boundaryCollections.get(boundarySource.id);
    if (boundaryCollection === undefined) {
      boundaryCollection = JSON.parse(
        await readFile(sourceFiles.get(boundarySource.id).path, "utf8"),
      );
      boundaryCollections.set(boundarySource.id, boundaryCollection);
    }
    resolveCoverageTargetBoundary(target, boundarySource, boundaryCollection);
  }

  const gdalVersion = verifyGdalImage();
  console.log(`Using ${gdalVersion}.`);

  const artifactSources = [];
  const clippedFeatures = [];
  const rawFeatures = [];
  let removedNonPolygonComponentCount = 0;
  const hazardSources = config.sources.filter(
    (source) => source.responsibilityArea !== undefined,
  );

  for (const target of config.coverageTargets) {
    const boundarySource = sourcesById.get(target.boundarySourceId);
    const boundaryClip = createBoundaryClip(target, boundarySource);
    for (const source of hazardSources) {
      const designationStatus =
        source.responsibilityArea === "sra"
          ? "effective"
          : target.lraDesignationStatus;
      const outputFileName = `${source.id}-${target.id}.geojson`;
      const clippedFileName = `${source.id}-${target.id}-clipped.geojson`;
      const outputPath = join(intermediateDirectory, outputFileName);

      console.log(
        `Clipping ${source.id.toUpperCase()} to ${target.label}...`,
      );
      runGdal([
        "ogr2ogr",
        "-overwrite",
        "-f",
        "GeoJSON",
        `/work/work/intermediate/${clippedFileName}`,
        source.gdalDataSource,
        "-dialect",
        "OGRSQL",
        "-sql",
        `SELECT FHSZ_Description AS FHSZ FROM ${quoteIdentifier(source.gdalLayer)}`,
        "-clipsrc",
        boundaryClip.dataSource,
        "-clipsrclayer",
        boundaryClip.layer,
        "-clipsrcwhere",
        boundaryClip.where,
        "-t_srs",
        "EPSG:4326",
        "-dim",
        "XY",
        "-nlt",
        "PROMOTE_TO_MULTI",
        "-nln",
        "wildfire_clip",
        "-lco",
        "RFC7946=YES",
        "-lco",
        `COORDINATE_PRECISION=${config.artifact.coordinatePrecision}`,
      ]);

      const clippedCollection = JSON.parse(
        await readFile(join(intermediateDirectory, clippedFileName), "utf8"),
      );
      removedNonPolygonComponentCount +=
        countNonPolygonComponents(clippedCollection);
      for (const feature of clippedCollection.features) {
        clippedFeatures.push({
          ...feature,
          properties: {
            FHSZ: feature.properties?.FHSZ,
            responsibilityArea: source.responsibilityArea,
            designationStatus,
            sourceVersion: source.version,
            jurisdiction: target.label,
            coverageTargetId: target.id,
            coverageTargetLabel: target.label,
          },
        });
      }

      if (clippedCollection.features.length === 0) {
        await writeFile(
          outputPath,
          `${JSON.stringify({ type: "FeatureCollection", features: [] })}\n`,
        );
      } else {
        runGdal([
          "ogr2ogr",
          "-overwrite",
          "-f",
          "GeoJSON",
          `/work/work/intermediate/${outputFileName}`,
          `/work/work/intermediate/${clippedFileName}`,
          "-dialect",
          "SQLite",
          "-sql",
          "SELECT FHSZ, " +
            "ST_CollectionExtract(ST_MakeValid(geometry), 3) AS geometry " +
            "FROM wildfire_clip WHERE NOT " +
            "ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(geometry), 3))",
          "-nlt",
          "PROMOTE_TO_MULTI",
          "-nln",
          "wildfire_input",
          "-lco",
          "RFC7946=YES",
          "-lco",
          `COORDINATE_PRECISION=${config.artifact.coordinatePrecision}`,
        ]);
      }

      const featureCollection = JSON.parse(await readFile(outputPath, "utf8"));
      artifactSources.push({
        responsibilityArea: source.responsibilityArea,
        designationStatus,
        sourceVersion: source.version,
        jurisdiction: target.label,
        featureCollection,
      });

      for (const feature of featureCollection.features) {
        rawFeatures.push({
          ...feature,
          properties: {
            FHSZ: feature.properties?.FHSZ,
            responsibilityArea: source.responsibilityArea,
            designationStatus,
            sourceVersion: source.version,
            jurisdiction: target.label,
            coverageTargetId: target.id,
            coverageTargetLabel: target.label,
          },
        });
      }
    }
  }

  const artifact = buildWildfireHazardArtifact(artifactSources);
  enforceArtifactBudgets(artifact);

  const clippedInputPath = join(workDirectory, "clipped_input.geojson");
  const repairedInputPath = join(workDirectory, "repaired_input.geojson");
  const stagedArtifactPath = join(workDirectory, "artifact.geojson");
  await writeFile(
    clippedInputPath,
    `${JSON.stringify({ type: "FeatureCollection", features: clippedFeatures })}\n`,
  );
  await writeFile(
    repairedInputPath,
    `${JSON.stringify({ type: "FeatureCollection", features: rawFeatures })}\n`,
  );
  await writeFile(stagedArtifactPath, artifact.json);

  const clippedInputQuality = queryGeometryQuality(
    "/work/work/clipped_input.geojson",
    "clipped_input",
    "FHSZ",
  );
  const repairedInputQuality = queryGeometryQuality(
    "/work/work/repaired_input.geojson",
    "repaired_input",
    "FHSZ",
  );
  const outputQuality = queryGeometryQuality(
    "/work/work/artifact.geojson",
    "artifact",
    "severity",
  );
  const inputQualityByTarget = queryGeometryQualityByTarget(
    "/work/work/repaired_input.geojson",
    "repaired_input",
  );
  const quality = reconcileQuality(
    clippedInputQuality,
    repairedInputQuality,
    outputQuality,
    artifact,
    removedNonPolygonComponentCount,
    inputQualityByTarget,
  );

  const manifest = createWildfireHazardManifest({
    artifact,
    artifactFileName: config.artifact.fileName,
    artifactVersion: config.artifact.version,
    snapshotAt: config.artifact.snapshotAt,
    gdalImage: config.gdal.image,
    nodeVersion: config.gdal.nodeVersion,
    sources: config.sources.map((source) => {
      const prepared = sourceFiles.get(source.id);
      return {
        id: source.id,
        title: source.title,
        canonicalUrl: source.canonicalUrl,
        downloadUrl: source.downloadUrl,
        sha256: source.sha256,
        bytes: prepared.bytes,
        upstreamSnapshotSha256: source.upstreamSnapshotSha256,
        upstreamSnapshotBytes: source.upstreamSnapshotBytes,
        version: source.version,
        license: source.license,
        attribution: source.attribution,
      };
    }),
    designationEvidence: config.designationEvidence,
    coverageTargets: config.coverageTargets,
    quality,
  });

  const manifestJson = serializeManifest(manifest);
  await writeArtifactFiles(stagingDirectory, artifact.json, manifestJson);
  if (options.mode === "publish") {
    await writeArtifactFiles(outputDirectory, artifact.json, manifestJson);
  }

  console.log(
    `${options.mode === "publish" ? "Published" : "Staged"} ` +
      `${artifact.statistics.featureCount} features: ` +
      `${artifact.statistics.rawBytes} raw bytes, ` +
      `${artifact.statistics.gzipBytes} gzip bytes.`,
  );
  console.log(`Artifact SHA-256: ${artifact.sha256}`);
}

function parseBuildOptions(arguments_) {
  const allowed = new Set(["--offline", "--publish", "--stage-only"]);
  for (const argument of arguments_) {
    if (!allowed.has(argument)) {
      throw new Error(`Unknown wildfire build argument: ${argument}.`);
    }
  }

  const stageOnly = arguments_.includes("--stage-only");
  const publish = arguments_.includes("--publish");
  if (stageOnly === publish) {
    throw new Error("Choose exactly one wildfire build mode: --stage-only or --publish.");
  }
  return {
    mode: stageOnly ? "stage" : "publish",
    offline: arguments_.includes("--offline"),
  };
}

function assertPinnedNodeVersion() {
  if (process.versions.node !== config.gdal.nodeVersion) {
    throw new Error(
      `Wildfire data builds require Node ${config.gdal.nodeVersion}; ` +
        `received ${process.versions.node}.`,
    );
  }
}

async function prepareSource(source, options) {
  const destination = join(sourceDirectory, source.fileName);
  if (source.trackedPath !== undefined) {
    const trackedPath = resolve(repositoryRoot, source.trackedPath);
    if (!trackedPath.startsWith(`${repositoryRoot}/`)) {
      throw new Error(`Tracked source ${source.id} escapes the repository.`);
    }
    const tracked = await inspectFile(trackedPath);
    if (tracked === null || tracked.sha256 !== source.sha256) {
      throw new Error(`Tracked source ${source.id} failed checksum verification.`);
    }
    if (tracked.bytes > source.maximumBytes) {
      throw new Error(`Tracked source ${source.id} exceeds its size limit.`);
    }
    await copyFile(trackedPath, destination);
    return { path: destination, bytes: tracked.bytes };
  }

  const existing = await inspectFile(destination);
  if (existing !== null) {
    if (existing.sha256 !== source.sha256) {
      throw new Error(
        `Cached source ${source.fileName} failed checksum verification. ` +
          "Remove it before retrying.",
      );
    }
    return { path: destination, bytes: existing.bytes };
  }

  if (options.offline) {
    throw new Error(
      `Offline wildfire build requires cached source ${source.fileName}.`,
    );
  }

  const partial = `${destination}.partial`;
  await unlink(partial).catch((error) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });

  const response = await fetch(source.downloadUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(180_000),
    headers: {
      "user-agent": "chaoran-property-intelligence-wildfire-data-builder/1.0",
    },
  });
  if (!response.ok || response.body === null) {
    throw new Error(
      `Failed to download ${source.id}: HTTP ${response.status}.`,
    );
  }
  if (!response.url.startsWith("https://")) {
    throw new Error(`Source ${source.id} redirected away from HTTPS.`);
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > source.maximumBytes
  ) {
    throw new Error(`Source ${source.id} exceeds its download size limit.`);
  }

  const handle = await open(partial, "wx");
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > source.maximumBytes) {
        throw new Error(`Source ${source.id} exceeds its download size limit.`);
      }
      hash.update(chunk);
      await handle.write(chunk);
    }
  } catch (error) {
    await handle.close();
    await unlink(partial).catch(() => undefined);
    throw error;
  }
  await handle.close();

  const actualHash = hash.digest("hex");
  if (actualHash !== source.sha256) {
    await unlink(partial);
    throw new Error(
      `Downloaded source ${source.id} failed checksum verification.`,
    );
  }

  await rename(partial, destination);
  return { path: destination, bytes };
}

async function inspectFile(path) {
  try {
    const fileStat = await stat(path);
    return {
      bytes: fileStat.size,
      sha256: await sha256File(path),
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function verifyGdalImage() {
  const result = runGdal(["gdalinfo", "--version"]);
  const version = result.trim();
  if (!version.startsWith(`GDAL ${config.gdal.version} `)) {
    throw new Error(
      `Expected GDAL ${config.gdal.version}; container reported ${version}.`,
    );
  }
  return version;
}

function runGdal(arguments_) {
  const dockerArguments = [
    "run",
    "--rm",
    "--network=none",
    "-v",
    `${cacheRoot}:/work`,
  ];

  if (typeof process.getuid === "function" && typeof process.getgid === "function") {
    dockerArguments.push("--user", `${process.getuid()}:${process.getgid()}`);
  }

  dockerArguments.push(config.gdal.image, ...arguments_);
  const result = spawnSync("docker", dockerArguments, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `GDAL command failed with exit code ${result.status}:\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function queryGeometryQuality(containerPath, layerName, severityField) {
  const allowed =
    severityField === "FHSZ"
      ? "'Moderate','High','Very High'"
      : "'moderate','high','very-high'";
  const sql =
    `SELECT ${quoteIdentifier(severityField)} AS severity, ` +
    "COUNT(*) AS feature_count, " +
    "SUM(ST_Area(ST_Transform(geometry, 3310))) AS area_square_meters, " +
    "SUM(CASE WHEN ST_IsValid(geometry) THEN 0 ELSE 1 END) " +
    `AS invalid_geometry_count FROM ${quoteIdentifier(layerName)} ` +
    `WHERE ${quoteIdentifier(severityField)} IN (${allowed}) ` +
    `GROUP BY ${quoteIdentifier(severityField)}`;

  const output = runGdal([
    "ogrinfo",
    "-ro",
    "-q",
    "-json",
    "-features",
    "-geom=no",
    "-dialect",
    "SQLite",
    "-sql",
    sql,
    containerPath,
  ]);
  const parsed = JSON.parse(output);
  const rows = parsed.layers?.[0]?.features ?? [];
  const bySeverity = {};

  for (const row of rows) {
    const sourceSeverity = row.properties.severity;
    const severity = normalizeQualitySeverity(sourceSeverity);
    bySeverity[severity] = {
      featureCount: Number(row.properties.feature_count),
      areaSquareMeters: Number(row.properties.area_square_meters),
      invalidGeometryCount: Number(row.properties.invalid_geometry_count),
    };
  }

  return bySeverity;
}

function queryGeometryQualityByTarget(containerPath, layerName) {
  const sql =
    'SELECT "coverageTargetId" AS target_id, ' +
    '"coverageTargetLabel" AS target_label, "FHSZ" AS severity, ' +
    "COUNT(*) AS feature_count, " +
    "SUM(ST_Area(ST_Transform(geometry, 3310))) AS area_square_meters, " +
    "SUM(CASE WHEN ST_IsValid(geometry) THEN 0 ELSE 1 END) " +
    `AS invalid_geometry_count FROM ${quoteIdentifier(layerName)} ` +
    "WHERE \"FHSZ\" IN ('Moderate','High','Very High') " +
    'GROUP BY "coverageTargetId", "coverageTargetLabel", "FHSZ"';

  const output = runGdal([
    "ogrinfo",
    "-ro",
    "-q",
    "-json",
    "-features",
    "-geom=no",
    "-dialect",
    "SQLite",
    "-sql",
    sql,
    containerPath,
  ]);
  const rows = JSON.parse(output).layers?.[0]?.features ?? [];
  const byCoverageTarget = Object.fromEntries(
    config.coverageTargets.map((target) => [
      target.id,
      {
        label: target.label,
        inputEligibleFeatureCount: 0,
        inputAreaSquareMeters: 0,
        invalidGeometryCount: 0,
        bySeverity: {},
      },
    ]),
  );

  for (const row of rows) {
    const targetId = row.properties.target_id;
    const target = byCoverageTarget[targetId];
    if (target === undefined) {
      throw new Error(`GDAL QA returned unknown coverage target ${String(targetId)}.`);
    }
    if (row.properties.target_label !== target.label) {
      throw new Error(`GDAL QA label mismatch for coverage target ${targetId}.`);
    }
    const severity = normalizeQualitySeverity(row.properties.severity);
    const metrics = {
      featureCount: Number(row.properties.feature_count),
      areaSquareMeters: roundMetric(Number(row.properties.area_square_meters)),
      invalidGeometryCount: Number(row.properties.invalid_geometry_count),
    };
    if (metrics.invalidGeometryCount !== 0) {
      throw new Error(`Invalid ${severity} geometry detected for ${targetId}.`);
    }
    target.bySeverity[severity] = metrics;
    target.inputEligibleFeatureCount += metrics.featureCount;
    target.inputAreaSquareMeters += metrics.areaSquareMeters;
  }

  for (const target of Object.values(byCoverageTarget)) {
    target.inputAreaSquareMeters = roundMetric(target.inputAreaSquareMeters);
  }
  return byCoverageTarget;
}

function reconcileQuality(
  clippedInput,
  repairedInput,
  output,
  artifact,
  removedNonPolygonComponentCount,
  inputQualityByTarget,
) {
  const bySeverity = {};
  let inputFeatureCount = 0;
  let outputFeatureCount = 0;
  let inputAreaSquareMeters = 0;
  let outputAreaSquareMeters = 0;

  for (const severity of ["moderate", "high", "very-high"]) {
    const clippedMetrics = clippedInput[severity] ?? emptyQualityMetrics();
    const inputMetrics = repairedInput[severity] ?? emptyQualityMetrics();
    const outputMetrics = output[severity] ?? emptyQualityMetrics();
    if (inputMetrics.invalidGeometryCount !== 0 || outputMetrics.invalidGeometryCount !== 0) {
      throw new Error(`Invalid ${severity} geometry detected by GDAL.`);
    }
    if (clippedMetrics.featureCount !== inputMetrics.featureCount) {
      throw new Error(
        `${severity} feature count changed during geometry repair: ` +
          `${clippedMetrics.featureCount} -> ${inputMetrics.featureCount}.`,
      );
    }
    if (inputMetrics.featureCount !== outputMetrics.featureCount) {
      throw new Error(
        `${severity} feature count changed during normalization: ` +
          `${inputMetrics.featureCount} -> ${outputMetrics.featureCount}.`,
      );
    }

    const areaDriftRatio = calculateDriftRatio(
      inputMetrics.areaSquareMeters,
      outputMetrics.areaSquareMeters,
    );
    if (areaDriftRatio > config.artifact.maximumAreaDriftRatio) {
      throw new Error(
        `${severity} area drift ${areaDriftRatio} exceeds the limit.`,
      );
    }
    const repairAreaDriftRatio = calculateDriftRatio(
      clippedMetrics.areaSquareMeters,
      inputMetrics.areaSquareMeters,
    );
    if (repairAreaDriftRatio > config.artifact.maximumAreaDriftRatio) {
      throw new Error(
        `${severity} repair area drift ${repairAreaDriftRatio} exceeds the limit.`,
      );
    }

    bySeverity[severity] = {
      clippedFeatureCount: clippedMetrics.featureCount,
      clippedInvalidGeometryCount: clippedMetrics.invalidGeometryCount,
      inputFeatureCount: inputMetrics.featureCount,
      outputFeatureCount: outputMetrics.featureCount,
      clippedAreaSquareMeters: roundMetric(clippedMetrics.areaSquareMeters),
      inputAreaSquareMeters: roundMetric(inputMetrics.areaSquareMeters),
      outputAreaSquareMeters: roundMetric(outputMetrics.areaSquareMeters),
      repairAreaDriftRatio,
      areaDriftRatio,
    };
    inputFeatureCount += inputMetrics.featureCount;
    outputFeatureCount += outputMetrics.featureCount;
    inputAreaSquareMeters += inputMetrics.areaSquareMeters;
    outputAreaSquareMeters += outputMetrics.areaSquareMeters;
  }

  if (outputFeatureCount !== artifact.statistics.featureCount) {
    throw new Error("Artifact feature count does not match GDAL QA output.");
  }

  return {
    clippingBoundary:
      `union of ${config.coverageTargets.length} reviewed coverage-target boundaries`,
    outputCrs: "EPSG:4326",
    coordinatePrecision: config.artifact.coordinatePrecision,
    clippedInvalidGeometryCount: Object.values(clippedInput).reduce(
      (total, metrics) => total + metrics.invalidGeometryCount,
      0,
    ),
    repairedInvalidGeometryCount: Object.values(repairedInput).reduce(
      (total, metrics) => total + metrics.invalidGeometryCount,
      0,
    ),
    inputEligibleFeatureCount: inputFeatureCount,
    outputFeatureCount,
    excludedNonWildlandFeatureCount:
      artifact.statistics.excludedNonWildlandCount,
    inputAreaSquareMeters: roundMetric(inputAreaSquareMeters),
    outputAreaSquareMeters: roundMetric(outputAreaSquareMeters),
    areaDriftRatio: calculateDriftRatio(
      inputAreaSquareMeters,
      outputAreaSquareMeters,
    ),
    invalidGeometryCount: 0,
    removedZeroAreaNonPolygonComponentCount:
      removedNonPolygonComponentCount,
    bySeverity,
    byCoverageTarget: inputQualityByTarget,
    budgets: {
      maximumRawBytes: config.artifact.maximumRawBytes,
      actualRawBytes: artifact.statistics.rawBytes,
      maximumGzipBytes: config.artifact.maximumGzipBytes,
      actualGzipBytes: artifact.statistics.gzipBytes,
    },
  };
}

function countNonPolygonComponents(collection) {
  let count = 0;
  for (const feature of collection.features ?? []) {
    if (feature.geometry?.type === "GeometryCollection") {
      count += feature.geometry.geometries.filter(
        (geometry) =>
          geometry.type !== "Polygon" && geometry.type !== "MultiPolygon",
      ).length;
    } else if (
      feature.geometry?.type !== "Polygon" &&
      feature.geometry?.type !== "MultiPolygon"
    ) {
      count += 1;
    }
  }
  return count;
}

function emptyQualityMetrics() {
  return {
    featureCount: 0,
    areaSquareMeters: 0,
    invalidGeometryCount: 0,
  };
}

function calculateDriftRatio(input, output) {
  if (input === 0) {
    return output === 0 ? 0 : Infinity;
  }
  return Number((Math.abs(output - input) / input).toPrecision(8));
}

function roundMetric(value) {
  return Math.round(value * 1000) / 1000;
}

function normalizeQualitySeverity(value) {
  const normalized = {
    Moderate: "moderate",
    High: "high",
    "Very High": "very-high",
    moderate: "moderate",
    high: "high",
    "very-high": "very-high",
  }[value];
  if (normalized === undefined) {
    throw new Error(`Unknown GDAL quality severity: ${String(value)}.`);
  }
  return normalized;
}

function enforceArtifactBudgets(artifact) {
  if (artifact.statistics.rawBytes > config.artifact.maximumRawBytes) {
    throw new Error("Wildfire GeoJSON exceeds the 10 MiB raw size limit.");
  }
  if (artifact.statistics.gzipBytes > config.artifact.maximumGzipBytes) {
    throw new Error("Wildfire GeoJSON exceeds the 2 MiB gzip size limit.");
  }
}

async function writeArtifactFiles(directory, artifactJson, manifestJson) {
  await mkdir(directory, { recursive: true });
  const artifactPath = join(directory, config.artifact.fileName);
  const manifestPath = join(directory, config.artifact.manifestFileName);
  const artifactTemporaryPath = `${artifactPath}.tmp`;
  const manifestTemporaryPath = `${manifestPath}.tmp`;

  await writeFile(artifactTemporaryPath, artifactJson);
  await writeFile(manifestTemporaryPath, manifestJson);
  await rename(artifactTemporaryPath, artifactPath);
  await rename(manifestTemporaryPath, manifestPath);
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe OGR identifier: ${value}.`);
  }
  return `"${value}"`;
}
