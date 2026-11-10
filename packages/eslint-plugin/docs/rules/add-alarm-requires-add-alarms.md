# composurecdk/add-alarm-requires-add-alarms

Flags a class that declares `addAlarm` without the batch `addAlarms` beside it.

- **Preset:** `internal` (`error`)

## Why

Every composureCDK builder with `addAlarm(key, configure)` also offers `addAlarms(alarms)`, which adds a whole record of alarms in one step of the chain ([#706](https://github.com/laazyj/composureCDK/issues/706)). The two are copied into each builder rather than supplied by a shared decorator, because `addAlarm` and the list it fills already live on each builder class, typed to its construct. So nothing but this rule notices when a new builder gains `addAlarm` and not `addAlarms`, leaving the API uneven.

It is an `internal` rule: the pairing is a convention of this repo's builders, not a hazard in yours.

## ❌ Incorrect

```ts
class QueueBuilder {
  addAlarm(key: string, configure: AlarmConfigurer<IQueue>): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<IQueue>(key)));
    return this;
  }
}
```

## ✅ Correct

```ts
class QueueBuilder {
  addAlarm(key: string, configure: AlarmConfigurer<IQueue>): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<IQueue>(key)));
    return this;
  }

  addAlarms(alarms: Record<string, AlarmConfigurer<IQueue>>): this {
    for (const [key, configure] of Object.entries(alarms)) {
      this.addAlarm(key, configure);
    }
    return this;
  }
}
```

## How it works

Syntactic. Any class body with a method named `addAlarm` (a plain identifier key, not computed and not a property holding a function) must also declare a method named `addAlarms`. Its signature and body are not inspected; delegate to `addAlarm` as above so the two cannot drift.
