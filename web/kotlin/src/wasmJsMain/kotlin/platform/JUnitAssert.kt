// `import org.junit.Assert.*` imports Java statics on the JVM; a package of the same
// name gives the unchanged test files the same functions here.
package org.junit.Assert

import org.junit.Assertion
import org.junit.Recorder
import showcase.platform.JClass

fun assertEquals(message: String, expected: Any?, actual: Any?) {
    val n = Recorder.results.count { it.test == Recorder.test } + 1
    Recorder.results.add(Assertion(Recorder.test, "#$n $message", "$expected", "$actual", expected == actual))
}

fun <T : Throwable> assertThrows(message: String, expectedThrowable: JClass<T>, runnable: () -> Unit): T? {
    val n = Recorder.results.count { it.test == Recorder.test } + 1
    val name = expectedThrowable.kclass.simpleName ?: "Throwable"
    val thrown = try { runnable(); null } catch (e: Throwable) { e }
    val pass = thrown != null && expectedThrowable.kclass.isInstance(thrown)
    val actual = thrown?.let { it::class.simpleName ?: "Throwable" } ?: "nothing thrown"
    Recorder.results.add(Assertion(Recorder.test, "#$n $message", "throws $name", actual, pass))
    @Suppress("UNCHECKED_CAST")
    return if (pass) thrown as T else null
}
