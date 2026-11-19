// On the JVM `Class` and `.java` come from java.lang; Kotlin/Wasm has neither, so each app
// package that names them gets a same-named alias that the unqualified references resolve to.
package com.diches.dichboxmobile.api.user

typealias Class<T> = showcase.platform.JClass<T>

internal val <T : Any> kotlin.reflect.KClass<T>.java: Class<T> get() = Class(this)
