/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_VOICE?: string }
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const c: DefineComponent<object, object, unknown>
  export default c
}
