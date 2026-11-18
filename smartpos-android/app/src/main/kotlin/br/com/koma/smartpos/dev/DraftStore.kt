package br.com.koma.smartpos.dev

import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

internal class DraftStore(private val directory: File) {
    fun load(scope: String): MutableMap<Int, MutableList<Line>> {
        val target = file(scope)
        if (!target.exists()) return mutableMapOf()
        val raw = runCatching {
            runCatching { AtomicFile(target).readFully() }.getOrElse { target.readBytes() }
                .toString(Charsets.UTF_8)
        }.getOrNull() ?: return mutableMapOf()

        return runCatching { decodeDrafts(raw) }.getOrElse { mutableMapOf() }
    }

    fun save(scope: String, drafts: Map<Int, List<Line>>) {
        directory.mkdirs()
        val target = file(scope)
        val nonEmpty = drafts.filterValues { it.isNotEmpty() }
        if (nonEmpty.isEmpty()) {
            runCatching { AtomicFile(target).delete() }
            target.delete()
            return
        }
        val payload = encodeDrafts(nonEmpty).toByteArray(Charsets.UTF_8)
        val atomicOk = runCatching {
            val atomic = AtomicFile(target)
            val stream = atomic.startWrite()
            try {
                stream.write(payload)
                atomic.finishWrite(stream)
            } catch (exc: Exception) {
                atomic.failWrite(stream)
                throw exc
            }
            true
        }.getOrDefault(false)
        if (!atomicOk) {
            val tmp = File(target.parentFile, "${target.name}.tmp")
            tmp.writeBytes(payload)
            if (!tmp.renameTo(target)) {
                target.writeBytes(payload)
                tmp.delete()
            }
        }
    }

    fun clearScope(scope: String) {
        val target = file(scope)
        runCatching { AtomicFile(target).delete() }
        target.delete()
    }

    private fun encodeDrafts(drafts: Map<Int, List<Line>>): String {
        val root = JSONObject()
        drafts.forEach { (tableId, lines) ->
            val arr = JSONArray()
            lines.forEach { line ->
                val prod = line.product
                val productObj = JSONObject()
                    .put("id", prod.id)
                    .put("categoryId", prod.categoryId)
                    .put("name", prod.name)
                    .put("price", prod.price)
                    .put("description", prod.description)
                    .put("familyId", prod.familyId)
                    .put("familyName", prod.familyName)
                    .put("familyAxis", prod.familyAxis)
                    .put("variantLabel", prod.variantLabel)
                val optsArr = JSONArray()
                line.options.forEach { opt ->
                    optsArr.put(
                        JSONObject()
                            .put("id", opt.id)
                            .put("name", opt.name)
                            .put("price", opt.price),
                    )
                }
                arr.put(
                    JSONObject()
                        .put("product", productObj)
                        .put("options", optsArr)
                        .put("note", line.note)
                        .put("quantity", line.quantity)
                        .put("clientName", line.clientName),
                )
            }
            root.put(tableId.toString(), arr)
        }
        return root.toString()
    }

    private fun decodeDrafts(raw: String): MutableMap<Int, MutableList<Line>> {
        val root = JSONObject(raw)
        val result = mutableMapOf<Int, MutableList<Line>>()
        val keys = root.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val tableId = key.toIntOrNull() ?: continue
            val arr = root.optJSONArray(key) ?: continue
            val list = mutableListOf<Line>()
            for (i in 0 until arr.length()) {
                val item = arr.getJSONObject(i)
                val prodObj = item.getJSONObject("product")
                val product = Product(
                    id = prodObj.getString("id"),
                    categoryId = prodObj.optString("categoryId"),
                    name = prodObj.getString("name"),
                    price = prodObj.getLong("price"),
                    groups = emptyList(),
                    description = prodObj.optString("description"),
                    familyId = prodObj.optString("familyId"),
                    familyName = prodObj.optString("familyName"),
                    familyAxis = prodObj.optString("familyAxis"),
                    variantLabel = prodObj.optString("variantLabel"),
                )
                val optsArr = item.optJSONArray("options") ?: JSONArray()
                val options = List(optsArr.length()) { idx ->
                    val opt = optsArr.getJSONObject(idx)
                    Option(
                        id = opt.getString("id"),
                        name = opt.getString("name"),
                        price = opt.getLong("price"),
                    )
                }
                val qty = item.optInt("quantity", 1).coerceAtLeast(1)
                list.add(
                    Line(
                        product = product,
                        options = options,
                        note = item.optString("note"),
                        quantity = qty,
                        clientName = item.optString("clientName"),
                    ),
                )
            }
            if (list.isNotEmpty()) result[tableId] = list
        }
        return result
    }

    private fun file(scope: String): File {
        val hash = MessageDigest.getInstance("SHA-256").digest(scope.toByteArray(Charsets.UTF_8))
        val identifier = hash.joinToString("") { "%02x".format(it) }
        return File(directory, "waiter-drafts-v1-$identifier")
    }
}
