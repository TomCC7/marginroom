// Keep the application's small synchronous database surface on Bun's native driver.
import {Database as SQLite} from 'bun:sqlite';
export default class Database extends SQLite {
 constructor(file,options={}) { super(file,{strict:true,...options}); }
 prepare(sql) {
  const statement=super.prepare(sql),get=statement.get.bind(statement);
  // Application helpers use undefined for a missing row.
  statement.get=(...args)=>get(...args)??undefined;
  return statement;
 }
 pragma(sql,{simple=false}={}) {
  const rows=this.prepare(`PRAGMA ${sql}`).all();
  return simple ? Object.values(rows[0]||{})[0] : rows;
 }
 // VACUUM INTO takes a consistent SQLite snapshot and refuses an existing file.
 backup(file) { this.prepare('VACUUM INTO ?').run(file); }
 close() { super.close(true); }
}
