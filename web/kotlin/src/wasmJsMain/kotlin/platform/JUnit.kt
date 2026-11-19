// org.junit as the app's unit tests use it. Instead of stopping at the first failure,
// every assertion is recorded so the page can list them all.
package org.junit

@Target(AnnotationTarget.FUNCTION)
annotation class Test

class Assertion(val test: String, val step: String, val expected: String, val actual: String, val pass: Boolean)

object Recorder {
    var test = ""
    val results = mutableListOf<Assertion>()
}
