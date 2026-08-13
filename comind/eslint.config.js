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
  },
  {
    // 无头核心：通用查询引擎必须保持与框架无关，禁止引入 Vue / Pinia / 任何 .vue 组件。
    files: ['src/core/query/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['vue', 'pinia', '*.vue'],
            message: 'src/core/query 必须保持无头（headless），禁止引入 Vue / Pinia / .vue 组件',
          },
        ],
      }],
    },
  }
]
