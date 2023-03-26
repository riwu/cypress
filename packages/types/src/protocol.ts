import type { SpecFile } from '.'
import type ProtocolMapping from 'devtools-protocol/types/protocol-mapping'

type Commands = ProtocolMapping.Commands
type Command<T extends keyof Commands> = Commands[T]
type Events = ProtocolMapping.Events
type Event<T extends keyof Events> = Events[T]

interface CDPClient {
  send<T extends Extract<keyof Commands, string>> (command: T, params?: Command<T>['paramsType'][0]): Promise<Command<T>['returnType']>
  on<T extends Extract<keyof Events, string>> (eventName: T, cb: (event: Event<T>[0]) => void): void
}

// TODO(protocol): This is basic for now but will evolve as we progress with the protocol work

export interface AppCaptureProtocolInterface {
  addRunnables (runnables: any): Promise<void>
  connectToBrowser (cdpClient: CDPClient): void
  beforeSpec (spec: SpecFile & { instanceId: string }): void
  afterSpec (): void
  beforeTest(test: { id: string, attempt: number, timestamp: number }): void
  afterTest(test: { id: string, attempt: number, wallClockDuration: number, timestamp: number }): void
}

export interface ProtocolManager extends AppCaptureProtocolInterface {
  setupProtocol(url?: string): Promise<void>
  protocolEnabled(): boolean
}
