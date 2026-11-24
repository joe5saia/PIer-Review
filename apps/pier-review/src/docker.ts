import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Connection, packagedDaemon, RemoteExecutionEnv } from "@earendil-works/pi-env";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

export const image = "alpine@sha256:49340b346798875b5592e5d420241f2f9cfba5f47e62ebb1446a1b34734e898f";
const exec = promisify(execFile);
export async function openEnvironment(id: string, source: string) {
  const name = `pier-${id}`;
  const arch = process.arch;
  if (arch !== "arm64" && arch !== "x64") {
    throw new Error("Docker must run locally on x64 or arm64");
  }
  const binary = packagedDaemon({ platform: "linux", arch });
  const { stdout } = await exec("docker", [
    "ps",
    "-aq",
    "--filter",
    `name=^/${name}$`,
    "--filter",
    `label=pier.thread=${id}`,
  ]);
  if (stdout.trim()) {
    await exec("docker", ["start", name]);
  } else {
    await exec("docker", [
      "run",
      "--pull=never",
      "-d",
      "--name",
      name,
      "--label",
      `pier.thread=${id}`,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      "65534:65534",
      "--pids-limit",
      "32",
      "--cpus",
      "0.5",
      "--memory",
      "96m",
      "--tmpfs",
      "/work:size=16m,mode=1777",
      "--tmpfs",
      "/tmp:size=16m,mode=1777",
      "-w",
      "/work",
      "--mount",
      `type=bind,src=${binary},dst=/pi-env,readonly`,
      image,
      "sleep",
      "infinity",
    ]);
  }
  const connection = new Connection({ command: ["docker", "exec", "-i", name, "/pi-env"] });
  const env = new RemoteExecutionEnv({ connection, id: name, cwd: "/work" });
  const close = async () => {
    connection.close();
    await exec("docker", ["rm", "-f", name]);
  };
  try {
    const wrote = await env.writeFile("/work/source.md", source, BACKGROUND_CONTEXT);
    if (!wrote.ok) {
      throw wrote.error;
    }
    return { env, close };
  } catch (error) {
    await close();
    throw error;
  }
}
