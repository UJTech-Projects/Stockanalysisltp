require('dotenv').config();
const axios = require('axios');
const db = require('../src/db');
// const format = require('pg-format'); // Removed as we use custom helper

// Simple helper since I can't easily install new packages without permission or risk.
function expand(rowCount, colCount, startParamIndex = 1) {
    let index = startParamIndex;
    const rows = [];
    for (let i = 0; i < rowCount; i++) {
        const cols = [];
        for (let j = 0; j < colCount; j++) {
            cols.push(`$${index++}`);
        }
        rows.push(`(${cols.join(',')})`);
    }
    return rows.join(',');
}

const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

async function sync() {
  console.log('Fetching OpenAPIScripMaster.json...');
  try {
    const response = await axios.get(SCRIP_MASTER_URL, { maxBodyLength: Infinity });
    const data = response.data;
    
    if (!Array.isArray(data)) {
        throw new Error('Invalid Scrip Master format');
    }

    console.log(`Fetched ${data.length} instruments. Starting DB sync...`);
    await db.query('TRUNCATE TABLE instrument_master');

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        
        const batchSize = 1000;
        let batch = [];
        
        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            batch.push([
                item.token,
                item.symbol,
                item.name,
                item.expiry || null,
                item.strike ? parseFloat(item.strike) : null,
                item.lotsize ? parseFloat(item.lotsize) : null,
                item.instrumenttype,
                item.exch_seg,
                item.tick_size ? parseFloat(item.tick_size) : null
            ]);

            if (batch.length === batchSize || i === data.length - 1) {
                const query = `
                    INSERT INTO instrument_master 
                    (token, symbol, name, expiry, strike, lotsize, instrumenttype, exch_seg, tick_size)
                    VALUES ${expand(batch.length, 9)}
                `;
                const flatValues = batch.flat();
                await client.query(query, flatValues);
                process.stdout.write(`\rSynced ${i + 1} / ${data.length}`);
                batch = [];
            }
        }

        await client.query('COMMIT');
        console.log('\nSync complete.');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }

  } catch (err) {
    console.error('Sync failed:', err.message);
  } finally {
    await db.pool.end();
  }
}

if (require.main === module) {
  sync();
}
