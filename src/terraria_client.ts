import * as path from "@std/path";
import { TextLineStream } from "@std/streams/text-line-stream";
import config from "../config.json" with { type: "json" };
import { discordBot, sendWebhook } from "./bot_client.ts";
import { hideIP, parseTags, printLog, regices } from "./utils.ts";

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
    new TextDecoder()
        .decode(output.stdout)
        .split("\n")
        .forEach((e) => {
            printLog({ from: logSource, logLevel: 1 }, e);
        });

    return output;
    // terrariaProcess.kill("SIGTERM");
}

export function handleChatMessage(line: string, show: boolean = true) {
    const matches = regices.chatMessage.exec(line);

    if (matches == null) return false;

    const player = matches.groups!["player"];
    const message = matches.groups!["message"];

    printLog({ from: logSource + "(ChatMessage)" }, line);
    if (!show) return true;

    if (player == "Server" && message.match(regices.forwardedDiscordMessage)) {
        return true;
    }

    sendWebhook({
        options: {
            username: parseTags(player),
            content: parseTags(message),
        },
    });
    return true;
}

export function handleJoinLeave(line: string, show: boolean = true) {
    const matches = regices.joinLeft.exec(line);

    if (matches == null) return false;

    const player = matches.groups!["player"];
    const type = matches.groups!["type"];

    printLog({ from: logSource + "(JoinLeave)" }, line);
    setTimeout(
        () => stdinWriter.write(new TextEncoder().encode("playing\n")),
        5000,
    );
    if (!show) return true;

    sendWebhook({
        options: {
            username: parseTags(player),
            content: `**${player} has ${type}.**`,
        },
    });
    return true;
}

export function handleServerOperation(line: string, show: boolean = true) {
    const matches = regices.serverOperation.exec(line);

    if (matches == null) return false;

    const operation = matches.groups!["operation"];

    printLog({ from: logSource + "(ServerOperation)", logLevel: 2 }, line);

    let m;
    if ((m = operation.match(regices.playersConnected))) {
        discordBot?.user?.setActivity({
            name: m[0],
        });
    }

    if (!show) return true;

    sendWebhook({
        options: {
            content: operation.replaceAll(
                /[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}:[0-9]{1,5}/g,
                hideIP,
            ),
        },
        isServerMsg: true,
    });
    return true;
}

export function handleServerProcess(line: string, show: boolean = true) {
    const matches = regices.serverProcess.exec(line);

    if (matches == null) return false;

    const operation = matches.groups!["operation"];
    const progressPerc = matches.groups!["progressPerc"];

    printLog({ from: logSource + "(ServerProcess)", logLevel: 3 }, line);
    if (!show) return true;

    sendWebhook({
        options: {
            content: (
                operation + (progressPerc ? `: ${progressPerc}%` : "")
            ).replaceAll(
                /[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}:[0-9]{1,5}/g,
                hideIP,
            ),
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

    printLog({ from: logSource + "(ServerConnection)", logLevel: 3 }, line);
    if (!show) return true;

    sendWebhook({
        options: {
            content: (
                `{${ipAddr}} ${verb} ${operation}` +
                (details ? `: ${details}` : "")
            ).replaceAll(
                /[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}:[0-9]{1,5}/g,
                hideIP,
            ),
        },
        isServerMsg: true,
    });
    return true;
}
