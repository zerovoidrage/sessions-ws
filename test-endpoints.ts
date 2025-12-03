/**
 * Скрипт для тестирования эндпоинтов WebSocket сервера
 * 
 * Использование:
 *   tsx test-endpoints.ts
 * 
 * Или с указанием URL:
 *   BASE_URL=http://localhost:3001 tsx test-endpoints.ts
 */

import http from 'http'
import https from 'https'
import jwt from 'jsonwebtoken'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001'
// Используем секрет из переменных окружения или создаем тестовый
// Для локального тестирования можно использовать любой секрет
const JWT_SECRET = process.env.TRANSCRIPTION_JWT_SECRET || process.env.TEST_JWT_SECRET || 'test-secret-for-local-testing'

// Цвета для вывода в консоль
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

interface TestResult {
  name: string
  status: 'pass' | 'fail' | 'skip'
  message?: string
  statusCode?: number
  response?: any
}

const results: TestResult[] = []

// Вспомогательная функция для HTTP/HTTPS запросов
function makeRequest(options: {
  method: string
  path: string
  body?: any
  headers?: Record<string, string>
}): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path, BASE_URL)
    const isHttps = url.protocol === 'https:'
    const httpModule = isHttps ? https : http
    
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      // Для HTTPS игнорируем ошибки сертификата (для тестирования)
      ...(isHttps ? { rejectUnauthorized: false } : {}),
    }

    const req = httpModule.request(requestOptions, (res) => {
      let body = ''
      res.on('data', (chunk) => {
        body += chunk.toString()
      })
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 500,
          body,
        })
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    if (options.body) {
      req.write(JSON.stringify(options.body))
    }

    req.end()
  })
}

// Генерация тестового JWT токена
function generateTestToken(payload: {
  sessionId: string
  sessionSlug: string
  identity: string
  userId?: string
}): string {
  return jwt.sign(
    {
      sub: payload.userId || payload.identity,
      sessionId: payload.sessionId,
      sessionSlug: payload.sessionSlug,
      identity: payload.identity,
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 час
      iat: Math.floor(Date.now() / 1000),
    },
    JWT_SECRET,
    { algorithm: 'HS256' }
  )
}

// Тесты
async function testHealthCheck() {
  console.log(`${colors.cyan}Testing /health endpoint...${colors.reset}`)
  try {
    const response = await makeRequest({
      method: 'GET',
      path: '/health',
    })

    if (response.statusCode === 200) {
      const data = JSON.parse(response.body)
      results.push({
        name: 'Health Check',
        status: 'pass',
        message: 'Health endpoint works',
        statusCode: response.statusCode,
        response: data,
      })
      console.log(`${colors.green}✓ Health check passed${colors.reset}`)
      console.log(`  Response:`, data)
    } else {
      results.push({
        name: 'Health Check',
        status: 'fail',
        message: `Expected 200, got ${response.statusCode}`,
        statusCode: response.statusCode,
      })
      console.log(`${colors.red}✗ Health check failed: ${response.statusCode}${colors.reset}`)
    }
  } catch (error: any) {
    results.push({
      name: 'Health Check',
      status: 'fail',
      message: error.message,
    })
    console.log(`${colors.red}✗ Health check error: ${error.message}${colors.reset}`)
  }
}

async function testMetrics() {
  console.log(`\n${colors.cyan}Testing /metrics endpoint...${colors.reset}`)
  try {
    const response = await makeRequest({
      method: 'GET',
      path: '/metrics',
    })

    if (response.statusCode === 200) {
      const data = JSON.parse(response.body)
      results.push({
        name: 'Metrics',
        status: 'pass',
        message: 'Metrics endpoint works',
        statusCode: response.statusCode,
        response: data,
      })
      console.log(`${colors.green}✓ Metrics endpoint passed${colors.reset}`)
      console.log(`  Response keys:`, Object.keys(data).join(', '))
    } else {
      results.push({
        name: 'Metrics',
        status: 'fail',
        message: `Expected 200, got ${response.statusCode}`,
        statusCode: response.statusCode,
      })
      console.log(`${colors.red}✗ Metrics endpoint failed: ${response.statusCode}${colors.reset}`)
    }
  } catch (error: any) {
    results.push({
      name: 'Metrics',
      status: 'fail',
      message: error.message,
    })
    console.log(`${colors.red}✗ Metrics endpoint error: ${error.message}${colors.reset}`)
  }
}

async function testActiveSpeakerValid() {
  console.log(`\n${colors.cyan}Testing /api/active-speaker with valid token...${colors.reset}`)
  try {
    const testToken = generateTestToken({
      sessionId: 'test-session-123',
      sessionSlug: 'test-room',
      identity: 'test-user:test-session-123',
      userId: 'test-user',
    })

    const response = await makeRequest({
      method: 'POST',
      path: '/api/active-speaker',
      body: {
        sessionSlug: 'test-room',
        identity: 'test-user:test-session-123',
        name: 'Test User',
        timestamp: Date.now(),
        token: testToken,
      },
    })

    if (response.statusCode === 200) {
      const data = JSON.parse(response.body)
      results.push({
        name: 'Active Speaker (Valid Token)',
        status: 'pass',
        message: 'Active speaker endpoint works with valid token',
        statusCode: response.statusCode,
        response: data,
      })
      console.log(`${colors.green}✓ Active speaker endpoint passed${colors.reset}`)
      console.log(`  Response:`, data)
    } else {
      results.push({
        name: 'Active Speaker (Valid Token)',
        status: 'fail',
        message: `Expected 200, got ${response.statusCode}: ${response.body}`,
        statusCode: response.statusCode,
      })
      console.log(`${colors.red}✗ Active speaker endpoint failed: ${response.statusCode}${colors.reset}`)
      console.log(`  Response:`, response.body)
    }
  } catch (error: any) {
    results.push({
      name: 'Active Speaker (Valid Token)',
      status: 'fail',
      message: error.message,
    })
    console.log(`${colors.red}✗ Active speaker endpoint error: ${error.message}${colors.reset}`)
  }
}

async function testActiveSpeakerInvalidToken() {
  console.log(`\n${colors.cyan}Testing /api/active-speaker with invalid token...${colors.reset}`)
  try {
    const response = await makeRequest({
      method: 'POST',
      path: '/api/active-speaker',
      body: {
        sessionSlug: 'test-room',
        identity: 'test-user:test-session-123',
        name: 'Test User',
        timestamp: Date.now(),
        token: 'invalid-token-12345',
      },
    })

    if (response.statusCode === 401) {
      results.push({
        name: 'Active Speaker (Invalid Token)',
        status: 'pass',
        message: 'Endpoint correctly rejects invalid token',
        statusCode: response.statusCode,
      })
      console.log(`${colors.green}✓ Active speaker endpoint correctly rejected invalid token${colors.reset}`)
    } else {
      results.push({
        name: 'Active Speaker (Invalid Token)',
        status: 'fail',
        message: `Expected 401, got ${response.statusCode}`,
        statusCode: response.statusCode,
      })
      console.log(`${colors.red}✗ Active speaker endpoint should reject invalid token${colors.reset}`)
    }
  } catch (error: any) {
    results.push({
      name: 'Active Speaker (Invalid Token)',
      status: 'fail',
      message: error.message,
    })
    console.log(`${colors.red}✗ Active speaker endpoint error: ${error.message}${colors.reset}`)
  }
}

async function testActiveSpeakerMissingFields() {
  console.log(`\n${colors.cyan}Testing /api/active-speaker with missing fields...${colors.reset}`)
  try {
    const response = await makeRequest({
      method: 'POST',
      path: '/api/active-speaker',
      body: {
        // Отсутствуют обязательные поля
        name: 'Test User',
      },
    })

    if (response.statusCode === 400) {
      results.push({
        name: 'Active Speaker (Missing Fields)',
        status: 'pass',
        message: 'Endpoint correctly validates required fields',
        statusCode: response.statusCode,
      })
      console.log(`${colors.green}✓ Active speaker endpoint correctly validates required fields${colors.reset}`)
    } else {
      results.push({
        name: 'Active Speaker (Missing Fields)',
        status: 'fail',
        message: `Expected 400, got ${response.statusCode}`,
        statusCode: response.statusCode,
      })
      console.log(`${colors.red}✗ Active speaker endpoint should validate required fields${colors.reset}`)
    }
  } catch (error: any) {
    results.push({
      name: 'Active Speaker (Missing Fields)',
      status: 'fail',
      message: error.message,
    })
    console.log(`${colors.red}✗ Active speaker endpoint error: ${error.message}${colors.reset}`)
  }
}

// Главная функция
async function runTests() {
  console.log(`${colors.blue}================================${colors.reset}`)
  console.log(`${colors.blue}Testing WebSocket Server Endpoints${colors.reset}`)
  console.log(`${colors.blue}================================${colors.reset}`)
  console.log(`Base URL: ${BASE_URL}`)
  console.log(`JWT Secret: ${JWT_SECRET.substring(0, 10)}...`)
  console.log(``)

  await testHealthCheck()
  await testMetrics()
  await testActiveSpeakerValid()
  await testActiveSpeakerInvalidToken()
  await testActiveSpeakerMissingFields()

  // Вывод итогов
  console.log(`\n${colors.blue}================================${colors.reset}`)
  console.log(`${colors.blue}Test Results Summary${colors.reset}`)
  console.log(`${colors.blue}================================${colors.reset}`)

  const passed = results.filter((r) => r.status === 'pass').length
  const failed = results.filter((r) => r.status === 'fail').length
  const skipped = results.filter((r) => r.status === 'skip').length

  results.forEach((result) => {
    const icon = result.status === 'pass' ? colors.green + '✓' : colors.red + '✗'
    console.log(`${icon} ${result.name}${colors.reset}`)
    if (result.message) {
      console.log(`  ${result.message}`)
    }
    if (result.statusCode) {
      console.log(`  Status Code: ${result.statusCode}`)
    }
  })

  console.log(``)
  console.log(`Total: ${results.length} | ${colors.green}Passed: ${passed}${colors.reset} | ${colors.red}Failed: ${failed}${colors.reset} | Skipped: ${skipped}`)
  console.log(``)

  process.exit(failed > 0 ? 1 : 0)
}

// Запуск тестов
runTests().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`)
  process.exit(1)
})

