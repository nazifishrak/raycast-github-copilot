/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `index` command */
  export type Index = ExtensionPreferences & {}
  /** Preferences accessible in the `explain-selection` command */
  export type ExplainSelection = ExtensionPreferences & {
  /** Custom Prompt - The instruction prompt to send to Copilot */
  "customPrompt": string
}
  /** Preferences accessible in the `set-model` command */
  export type SetModel = ExtensionPreferences & {}
  /** Preferences accessible in the `proofread-selection` command */
  export type ProofreadSelection = ExtensionPreferences & {
  /** Custom Prompt - The instruction prompt to send to Copilot */
  "customPrompt": string
}
}

declare namespace Arguments {
  /** Arguments passed to the `index` command */
  export type Index = {}
  /** Arguments passed to the `explain-selection` command */
  export type ExplainSelection = {}
  /** Arguments passed to the `set-model` command */
  export type SetModel = {}
  /** Arguments passed to the `proofread-selection` command */
  export type ProofreadSelection = {}
}

