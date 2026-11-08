import Database from 'better-sqlite3';
const db = new Database(':memory:');
db.exec('create table t(a)');
db.prepare('insert into t values (?)').run(1);
console.log('sqlite ok', db.prepare('select count(*) c from t').get());
