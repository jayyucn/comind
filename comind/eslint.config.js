import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import vueParser from 'vue-eslint-parser'

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['src/**/*.{js,jsx,ts,tsx,vue}'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        EventListener: 'readonly'
      }
    },
    rules: {
      'vue/multi-word-component-names': 'off'
    }
  }
]
