import * as path from "@std/path";
import { TextLineStream } from "@std/streams/text-line-stream";
import { parseMentions, sendWebhook, setBotActivity } from "./bot_client.ts";
import { hideIP, parseTags, printLog, regices } from "./utils.ts";

const _logSource = "TerrariaServer";

let terrariaProcess: Deno.ChildProcess | null | undefined;
let stdinWriter: WritableStreamDefaultWriter<Uint8Array<ArrayBufferLike>>;
let stdout: ReadableStream<string>;
let stderr: ReadableStream<string>;
let state: ITerrariaProcess["state"] = "Stopped";
export function spawnTerraria(
    binaryPath: string,
    options: {
        configPath?: string;
        moddedFolderPath?: string;
        modded?: boolean;
    },
): ITerrariaProcess {
    state = "Starting";
    const args: string[] =
        (options.modded ?? false)
            ? ["start", "--folder", options.moddedFolderPath!]
            : ["-config", options.configPath!];
    try {
        const command = new Deno.Command(binaryPath, {
            args: args,
            stdin: "piped",
            stdout: "piped",
            stderr: "piped",
            cwd: path.dirname(binaryPath),
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
            state: (state = "Running"),
        };
    } catch (error) {
        return {
            destroy: async (_?: unknown) => await null,
            state: (state = "Stopped"),
            error: error,
        };
    }
}

async function handleStdErr(stderrStream: ReadableStream<string>) {
    for await (const line of stderrStream.values()) {
        printLog({ from: "StdErr", logLevel: 1, isError: true }, line);
    }
}

async function stopServer(
    isRestarting: boolean = false,
): Promise<Deno.CommandOutput | null> {
    if (terrariaProcess == null || state != "Running") {
        printLog({ from: _logSource }, "Could not stop terraria server.");
        return null;
    }
    state = isRestarting ? "Restarting" : "Stopping";

    const output = await new Promise<Deno.CommandOutput | null>(
        (resolve, reject) => {
            stdinWriter.write(new TextEncoder().encode("exit\n"));

            let isResolved = false;
            const output = terrariaProcess!
                .output()
                .then((o) => {
                    isResolved = true;
                    return o;
                })
                .catch((error) => {
                    if (error instanceof TypeError && stdout.locked) {
                        printLog(
                            { from: _logSource, isError: true },
                            "Couldn't retrieve server's last messages: Stdout was locked.",
                        );
                    } else {
                        printLog({ from: _logSource, isError: true }, error);
                    }

                    isResolved = true;
                    return null;
                });

            const maxTries = 50;
            let i = 0;
            let intervalID = 0;
            intervalID = setInterval(
                (id, resolve, reject) => {
                    i++;
                    if (isResolved) {
                        clearInterval(id);
                        return resolve(output);
                    }
                    if (i >= maxTries) {
                        clearInterval(id);
                        terrariaProcess!.kill("SIGTERM");
                        return reject(
                            "Terraria process didn't respond, so it was forcibly stopped.",
                        );
                    }
                },
                500,
                intervalID,
                resolve,
                reject,
            );
        },
    );

    await stdinWriter.close();

    printLog({ from: _logSource, logLevel: 1 }, "Terraria Server stopped");
    if (output != null) {
        new TextDecoder()
            .decode(output.stdout)
            .split("\n")
            .forEach((e) => {
                printLog({ from: _logSource, logLevel: 1 }, e);
            });
    }

    Deno.kill(terrariaProcess.pid, "SIGTERM");
    terrariaProcess = null;
    state = isRestarting ? "Restarting" : "Stopped";

    return output;
}

export async function handleChatMessage(line: string, show: boolean = true) {
    const matches = regices.chatMessage.exec(line);

    if (matches == null) return false;

    const player = matches.groups!["player"];
    const message = matches.groups!["message"];

    printLog({ from: _logSource + "(ChatMessage)" }, line);
    if (!show) return true;

    if (player == "Server" && message.match(regices.forwardedDiscordMessage)) {
        return true;
    }

    sendWebhook({
        options: {
            username: parseTags(player),
            content: await parseMentions(parseTags(message)),
        },
    });
    return true;
}

export function handleJoinLeave(line: string, show: boolean = true) {
    const matches = regices.joinLeft.exec(line);

    if (matches == null) return false;

    const player = matches.groups!["player"];
    const type = matches.groups!["type"];

    printLog({ from: _logSource + "(JoinLeave)" }, line);
    if (!show) {
        stdinWriter.write(new TextEncoder().encode("playing\n"));
        return true;
    }

    sendWebhook({
        options: {
            username: parseTags(player),
            content: `**${player} has ${type}.**`,
        },
    }).then((_) => {
        stdinWriter.write(new TextEncoder().encode("playing\n"));
    });
    return true;
}

export function handleServerOperation(line: string, show: boolean = true) {
    const matches = regices.serverOperation.exec(line);

    if (matches == null) return false;

    const operation = matches.groups!["operation"];
    const doCheckPlayers = operation == "Server started";

    printLog({ from: _logSource + "(ServerOperation)", logLevel: 2 }, line);

    let m: RegExpMatchArray | null;
    if ((m = operation.match(regices.playersConnected))) {
        let connectedAmount = Number(m.groups!.amount);
        if (!Number.isFinite(connectedAmount)) {
            connectedAmount = 0;
        }
        setBotActivity(m[0], connectedAmount);
    }

    if (!show) {
        if (doCheckPlayers) {
            stdinWriter.write(new TextEncoder().encode("playing\n"));
        }
        return true;
    }

    sendWebhook({
        options: {
            content: operation.replaceAll(regices.ipAddrGlobalMatch, hideIP),
        },
        isServerMsg: true,
    }).then((_) => {
        if (doCheckPlayers) {
            stdinWriter.write(new TextEncoder().encode("playing\n"));
        }
    });
    return true;
}

export function handleServerProcess(line: string, show: boolean = true) {
    const matches = regices.serverProcess.exec(line);

    if (matches == null) return false;

    const operation = matches.groups!["operation"];
    const progressPerc = matches.groups!["progressPerc"];

    printLog({ from: _logSource + "(ServerProcess)", logLevel: 3 }, line);
    if (!show) return true;

    sendWebhook({
        options: {
            content: (
                operation + (progressPerc ? `: ${progressPerc}%` : "")
            ).replaceAll(regices.ipAddrGlobalMatch, hideIP),
        },
        isServerMsg: true,
    });
    return true;
}

export function handleServerConnection(line: string, show: boolean = true) {
    const matches = regices.connection.exec(line);

    if (matches == null) return false;

    const ipAddr = matches.groups!["ipAddr"].replace(/:[0-9]+$/, "");
    const verb = matches.groups!["verb"];
    const operation = matches.groups!["operation"];
    const details = matches.groups!["details"];

    printLog({ from: _logSource + "(ServerConnection)", logLevel: 3 }, line);
    if (!show) return true;

    sendWebhook({
        options: {
            content: (
                `{${ipAddr}} ${verb} ${operation}` +
                (details ? `: ${details}` : "")
            ).replaceAll(regices.ipAddrGlobalMatch, hideIP),
        },
        isServerMsg: true,
    });
    return true;
}

export interface ITerrariaProcess {
    stdin?: WritableStreamDefaultWriter<Uint8Array<ArrayBufferLike>>;
    stdout?: ReadableStream<string>;
    process?: Deno.ChildProcess;
    playerAmount?: number;
    destroy: (isRestarting?: boolean) => Promise<Deno.CommandOutput | null>;
    state: "Running" | "Starting" | "Restarting" | "Stopping" | "Stopped";
    error?: unknown;
}
