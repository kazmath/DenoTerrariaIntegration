import * as path from "@std/path";
import { TextLineStream } from "@std/streams/text-line-stream";

export function spawnTerraria(binPath: string, configPath: string) {
    const command = new Deno.Command(binPath, {
        args: ["-config", configPath],
        stdin: "piped",
        stdout: "piped",
        cwd: path.dirname(binPath),
    });
    const terrariaProcess = command.spawn();
    const stdout = terrariaProcess.stdout
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TextLineStream());
    const stdinWriter = terrariaProcess.stdin.getWriter();

    return {
        process: terrariaProcess,
        stdout: stdout,
        stdin: stdinWriter,
    };
}
