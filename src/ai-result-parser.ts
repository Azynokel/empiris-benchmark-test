import { loadPyodide } from "pyodide";
import { Metric } from "./types";
import { OpenAI } from "openai";

export async function getMetricsWithAI(result: string) {
    // We generate python code to parse the result and execute it with Pyodide
    const pyodide = await loadPyodide({});

    await pyodide.loadPackage(["numpy", "pandas"]);

    const globals = pyodide.toPy({
        result,
    });

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const aiResult = await openai.chat.completions.create({
        model: "o1-mini",
        messages: [
            {
                role: "user",
                content: `Analyze the following benchmark result and generate Python code to extract all relevant information in JSON format: ${result}`,
            },
        ],
        response_format: {
            type: "json_schema",
            json_schema: {
                name: "metrics-parser-py",
                schema: {
                    type: "object",
                    properties: {
                        code: {
                            type: "string",
                        },
                    },
                }
            },
        }
    });

    const aiGeneratedCode = aiResult.choices.at(0)?.message.content || "";

    // We reflect on the result and potentially do it again
    console.log("METRICS", aiGeneratedCode);

    const metrics = await pyodide.runPythonAsync(aiGeneratedCode, { globals });

    // We reflect on the result and potentially do it again
    console.log("METRICS", aiGeneratedCode, metrics);

    return [] as Metric[];
}