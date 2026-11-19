// com.google.gson as ContainerParsers.kt and ApiParser.kt use it. Gson maps JSON onto the
// app's data classes by reflection; here the same data classes are (de)serialized by
// kotlinx.serialization serializers generated for them (showcase.platform.Containers),
// with Gson's leniency: unknown keys ignored, nulls omitted, missing fields defaulted.
package com.google.gson

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import showcase.platform.JClass
import showcase.platform.decodeContainer
import showcase.platform.encodeContainer

class Gson {
    @Suppress("UNCHECKED_CAST")
    fun <T> fromJson(json: String, classOfT: JClass<T>): T = decodeContainer(json, classOfT.kclass) as T

    fun toJson(src: Any?): String = when (src) {
        null -> "null"
        is JsonElement -> src.toString()
        else -> encodeContainer(src)
    }
}

object JsonParser {
    fun parseString(json: String?): JsonElement = Json.parseToJsonElement(json ?: "null")
}
