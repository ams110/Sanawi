import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { startFakeSupabase } from './scripts/fake-supabase.mjs'
const fake = await startFakeSupabase()
writeFileSync('.env', `VITE_SUPABASE_URL=${fake.url}\nVITE_SUPABASE_ANON_KEY=${fake.anonKey}\n`)
const vite = spawn('npx', ['vite', '--port', '5198', '--strictPort'], { stdio: ['ignore','pipe','pipe'] })
await new Promise((r) => vite.stdout.on('data', (c) => String(c).includes('ready in') && r()))
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await (await b.newContext({ viewport:{width:400,height:880}, locale:'ar' })).newPage()
page.on('pageerror', (e) => console.log('ERR', String(e).slice(0,200)))
await page.goto('http://localhost:5198/', { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', fake.email); await page.fill('input[type="password"]', fake.password)
await page.click('button[type="submit"]'); await page.waitForTimeout(2500)
await page.goto('http://localhost:5198/wealth', { waitUntil: 'networkidle' }); await page.waitForTimeout(2000)
console.log('sections:', await page.locator('section').count())
console.log('has حساباتك:', (await page.locator('body').innerText()).includes('حساباتك'))
console.log('filtered:', await page.locator('section').filter({ hasText: 'حساباتك' }).count())
await b.close(); vite.kill(); rmSync('.env', {force:true}); await fake.stop()
