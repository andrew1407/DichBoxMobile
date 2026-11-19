// See JavaClass_api.kt: the unit tests in this package use `X::class.java`.
package com.diches.dichboxmobile

typealias Class<T> = showcase.platform.JClass<T>

internal val <T : Any> kotlin.reflect.KClass<T>.java: Class<T> get() = Class(this)
