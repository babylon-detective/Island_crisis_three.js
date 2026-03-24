import { logger, LogModule } from './Logger'

export type InputTraceSource = 'keyboard' | 'mouse' | 'touch' | 'gamepad' | 'system'
export type InputTraceTarget = 'input-system' | 'main' | 'player' | 'dialogue' | 'battle'
export type InputTraceResult = 'received' | 'consumed' | 'blocked' | 'ignored' | 'forwarded' | 'executed' | 'released'

interface InputTraceEvent {
  source: InputTraceSource
  target: InputTraceTarget
  command: string
  result: InputTraceResult
  details?: unknown
}

export function traceInputCommand(event: InputTraceEvent): void {
  const { source, target, command, result, details } = event
  const message = `${source} -> ${target}: ${command} [${result}]`

  if (details === undefined) {
    logger.info(LogModule.INPUT, message)
    return
  }

  logger.info(LogModule.INPUT, message, details)
}