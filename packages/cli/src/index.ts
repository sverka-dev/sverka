// @sverka/cli — public API

export { main, type MainDeps } from "./main.js";
export * from "./types.js";
export {
  ConsoleOutputWriter,
  createOutputWriter,
  wrapOutputWriter,
  type WriteSink,
} from "./output.js";
