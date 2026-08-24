import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    fullWidth?: boolean
    hideRightSidebarToggle?: boolean
  }
}

export {}
