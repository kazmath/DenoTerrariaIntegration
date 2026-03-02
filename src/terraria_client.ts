import * as path from "@std/path";
import { TextLineStream } from "@std/streams/text-line-stream";
import config from "../config.json" with { type: "json" };
import { printLog } from "./utils.ts";

const logSource = "TerrariaServer";

let terrariaProcess: Deno.ChildProcess;
let stdinWriter: WritableStreamDefaultWriter<Uint8Array<ArrayBufferLike>>;
let stdout: ReadableStream<string>;
let stderr: ReadableStream<string>;
export function spawnTerraria() {
    const command = new Deno.Command(config.terraria.binaryPath, {
        args: ["-config", config.terraria.configPath],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
        cwd: path.dirname(config.terraria.binaryPath),
    });
    terrariaProcess = command.spawn();
    stdinWriter = terrariaProcess.stdin.getWriter();
    stdout = terrariaProcess.stdout
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TextLineStream());
    stderr = terrariaProcess.stderr
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TextLineStream());

    handleStdErr(stderr);

    return {
        process: terrariaProcess,
        stdout: stdout,
        stdin: stdinWriter,
        destroy: stopServer,
    };
}

async function handleStdErr(stderrStream: ReadableStream<string>) {
    for await (const line of stderrStream) {
        printLog({ from: "StdErr", logLevel: 1, isError: true }, line);
    }
}

async function stopServer() {
    await stdinWriter.write(new TextEncoder().encode("exit\n"));
    await stdinWriter.close();
    const output = await terrariaProcess.output();
    printLog({ from: logSource, logLevel: 1 }, "Terraria Server stopped");
    return output;
    // terrariaProcess.kill("SIGTERM");
}
