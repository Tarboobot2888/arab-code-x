/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                    SovereignX Mini Game Engine v1.0                       ║
 * ║                    محرك ألعاب SovereignX المصغر                          ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  محرك ألعاب 3D بسيط و احترافي مكتوب بلغة C++ في ملف واحد                ║
 * ║  يدعم: نظام كيانات (ECS) - كاميرا FPS - إضاءة Phong - مشاهد 3D         ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  المتطلبات:                                                               ║
 * ║    - GLFW3        (نافذة و إدخال)  https://www.glfw.org                   ║
 * ║    - GLAD         (محمل OpenGL)    https://glad.dav1d.de                  ║
 * ║      قم بتوليد: C/C++ | gl Version 3.3 | Core Profile | Generate Loader   ║
 * ║      ثم ضع glad.h في مجلد include و glad.c بجانب هذا الملف               ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  التجميع (Linux):                                                         ║
 * ║    g++ engine.cpp glad.c -o engine -lglfw -ldl -lpthread -Wall -O2        ║
 * ║  التجميع (Windows MinGW):                                                 ║
 * ║    g++ engine.cpp glad.c -o engine.exe -lglfw3 -lopengl32 -lgdi32 -Wall   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

#include <glad/glad.h>
#include <GLFW/glfw3.h>

#include <iostream>
#include <vector>
#include <string>
#include <memory>
#include <cmath>
#include <cstddef>
#include <algorithm>
#include <ctime>

// ============================================================================
// ████████  نظام التسجيل (Logging)  ████████
// ============================================================================
namespace Log {
    enum Level { INFO, WARN, ERROR };
    void msg(Level lvl, const std::string& text) {
        const char* prefix[] = { "[INFO]", "[WARN]", "[ERROR]" };
        const char* color[]  = { "\033[36m", "\033[33m", "\033[31m" };
        std::cout << color[lvl] << prefix[lvl] << " \033[0m" << text << std::endl;
    }
}

// ============================================================================
// ████████  مكتبة الرياضيات (Math Library)  ████████
// ============================================================================
struct Vec2 {
    float x, y;
    Vec2(float x = 0, float y = 0) : x(x), y(y) {}
};

struct Vec3 {
    float x, y, z;
    Vec3(float x = 0, float y = 0, float z = 0) : x(x), y(y), z(z) {}
    Vec3 operator + (const Vec3& o) const { return Vec3(x + o.x, y + o.y, z + o.z); }
    Vec3 operator - (const Vec3& o) const { return Vec3(x - o.x, y - o.y, z - o.z); }
    Vec3 operator * (float s)       const { return Vec3(x * s, y * s, z * s); }
    Vec3 operator / (float s)       const { return Vec3(x / s, y / s, z / s); }
    float dot(const Vec3& o)        const { return x * o.x + y * o.y + z * o.z; }
    Vec3 cross(const Vec3& o)       const {
        return Vec3(y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x);
    }
    float length() const { return std::sqrt(dot(*this)); }
    Vec3 normalize() const { float l = length(); return l > 0 ? (*this) / l : Vec3(); }
    Vec3 lerp(const Vec3& o, float t) const { return (*this) * (1 - t) + o * t; }
};

struct Vec4 {
    float x, y, z, w;
    Vec4(float x = 0, float y = 0, float z = 0, float w = 1) : x(x), y(y), z(z), w(w) {}
};

struct Mat4 {
    float m[16];
    Mat4(bool identity = true) {
        for (int i = 0; i < 16; i++) m[i] = 0;
        if (identity) m[0] = m[5] = m[10] = m[15] = 1.0f;
    }
    static Mat4 perspective(float fovDeg, float aspect, float near, float far) {
        Mat4 r(false);
        float tanHalf = std::tan(fovDeg * 3.14159265f / 360.0f);
        r.m[0]  = 1.0f / (aspect * tanHalf);
        r.m[5]  = 1.0f / tanHalf;
        r.m[10] = -(far + near) / (far - near);
        r.m[11] = -1.0f;
        r.m[14] = -(2.0f * far * near) / (far - near);
        return r;
    }
    static Mat4 lookAt(Vec3 eye, Vec3 center, Vec3 up) {
        Vec3 f = (center - eye).normalize();
        Vec3 s = f.cross(up).normalize();
        Vec3 u = s.cross(f);
        Mat4 r;
        r.m[0] = s.x;  r.m[4] = s.y;  r.m[8]  = s.z;  r.m[12] = -s.dot(eye);
        r.m[1] = u.x;  r.m[5] = u.y;  r.m[9]  = u.z;  r.m[13] = -u.dot(eye);
        r.m[2] = -f.x; r.m[6] = -f.y; r.m[10] = -f.z; r.m[14] = f.dot(eye);
        return r;
    }
    static Mat4 translate(Vec3 t) {
        Mat4 r; r.m[12] = t.x; r.m[13] = t.y; r.m[14] = t.z; return r;
    }
    static Mat4 scale(Vec3 s) {
        Mat4 r; r.m[0] = s.x; r.m[5] = s.y; r.m[10] = s.z; return r;
    }
    static Mat4 rotate(float angleDeg, Vec3 axis) {
        float rad = angleDeg * 3.14159265f / 180.0f;
        float c = std::cos(rad), s = std::sin(rad);
        Vec3 a = axis.normalize();
        Mat4 r;
        r.m[0] = c + a.x*a.x*(1-c);       r.m[4] = a.x*a.y*(1-c) - a.z*s;   r.m[8]  = a.x*a.z*(1-c) + a.y*s;
        r.m[1] = a.y*a.x*(1-c) + a.z*s;   r.m[5] = c + a.y*a.y*(1-c);       r.m[9]  = a.y*a.z*(1-c) - a.x*s;
        r.m[2] = a.z*a.x*(1-c) - a.y*s;   r.m[6] = a.z*a.y*(1-c) + a.x*s;   r.m[10] = c + a.z*a.z*(1-c);
        return r;
    }
    Mat4 operator * (const Mat4& o) const {
        Mat4 res(false);
        for (int i = 0; i < 4; i++)
            for (int j = 0; j < 4; j++)
                for (int k = 0; k < 4; k++)
                    res.m[i*4+j] += m[i*4+k] * o.m[k*4+j];
        return res;
    }
};

// ============================================================================
// ████████  نظام الوقت (Time System)  ████████
// ============================================================================
class Time {
    float lastTime = 0;
    float currentTime = 0;
public:
    float deltaTime = 0;
    float totalTime = 0;
    int fps = 0;
    void update() {
        currentTime = (float)glfwGetTime();
        deltaTime = currentTime - lastTime;
        lastTime = currentTime;
        totalTime = currentTime;
        static float fpsTimer = 0; static int fpsCount = 0;
        fpsTimer += deltaTime; fpsCount++;
        if (fpsTimer >= 1.0f) { fps = fpsCount; fpsCount = 0; fpsTimer = 0; }
    }
};

// ============================================================================
// ████████  نظام المظللات (Shader System)  ████████
// ============================================================================
class Shader {
    GLuint programID = 0;
public:
    Shader(const char* vertSrc, const char* fragSrc) {
        GLuint vs = compile(vertSrc, GL_VERTEX_SHADER);
        GLuint fs = compile(fragSrc, GL_FRAGMENT_SHADER);
        programID = glCreateProgram();
        glAttachShader(programID, vs);
        glAttachShader(programID, fs);
        glLinkProgram(programID);
        checkLink();
        glDeleteShader(vs);
        glDeleteShader(fs);
    }
    ~Shader() { if (programID) glDeleteProgram(programID); }
    void use() const { glUseProgram(programID); }
    GLuint id() const { return programID; }

    void setMat4(const char* name, const Mat4& mat) {
        glUniformMatrix4fv(glGetUniformLocation(programID, name), 1, GL_FALSE, mat.m);
    }
    void setVec3(const char* name, Vec3 v) {
        glUniform3f(glGetUniformLocation(programID, name), v.x, v.y, v.z);
    }
    void setVec4(const char* name, Vec4 v) {
        glUniform4f(glGetUniformLocation(programID, name), v.x, v.y, v.z, v.w);
    }
    void setFloat(const char* name, float f) {
        glUniform1f(glGetUniformLocation(programID, name), f);
    }
    void setInt(const char* name, int i) {
        glUniform1i(glGetUniformLocation(programID, name), i);
    }

private:
    GLuint compile(const char* src, GLenum type) {
        GLuint s = glCreateShader(type);
        glShaderSource(s, 1, &src, nullptr);
        glCompileShader(s);
        GLint ok; glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
        if (!ok) {
            char log[1024]; glGetShaderInfoLog(s, 1024, nullptr, log);
            Log::msg(Log::ERROR, std::string("Shader Compile: ") + log);
        }
        return s;
    }
    void checkLink() {
        GLint ok; glGetProgramiv(programID, GL_LINK_STATUS, &ok);
        if (!ok) {
            char log[1024]; glGetProgramInfoLog(programID, 1024, nullptr, log);
            Log::msg(Log::ERROR, std::string("Shader Link: ") + log);
        }
    }
};

// ============================================================================
// ████████  نظام الشبكات (Mesh System)  ████████
// ============================================================================
struct Vertex {
    Vec3 position;
    Vec3 normal;
    Vec2 texCoord;
};

class Mesh {
    GLuint VAO = 0, VBO = 0, EBO = 0;
    GLsizei indexCount = 0;
public:
    Mesh(const std::vector<Vertex>& vertices, const std::vector<GLuint>& indices) {
        indexCount = static_cast<GLsizei>(indices.size());
        glGenVertexArrays(1, &VAO);
        glGenBuffers(1, &VBO);
        glGenBuffers(1, &EBO);
        glBindVertexArray(VAO);
        glBindBuffer(GL_ARRAY_BUFFER, VBO);
        glBufferData(GL_ARRAY_BUFFER, vertices.size() * sizeof(Vertex), vertices.data(), GL_STATIC_DRAW);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, EBO);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, indices.size() * sizeof(GLuint), indices.data(), GL_STATIC_DRAW);
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, position));
        glEnableVertexAttribArray(1);
        glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, normal));
        glEnableVertexAttribArray(2);
        glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, texCoord));
        glBindVertexArray(0);
    }
    ~Mesh() {
        glDeleteVertexArrays(1, &VAO);
        glDeleteBuffers(1, &VBO);
        glDeleteBuffers(1, &EBO);
    }
    void draw() const {
        glBindVertexArray(VAO);
        glDrawElements(GL_TRIANGLES, indexCount, GL_UNSIGNED_INT, nullptr);
        glBindVertexArray(0);
    }
};

// ============================================================================
// ████████  مولدات الأشكال (Primitive Generators)  ████████
// ============================================================================
std::shared_ptr<Mesh> createCube() {
    std::vector<Vertex> v = {
        // Front
        {Vec3(-0.5f,-0.5f, 0.5f), Vec3(0,0,1), Vec2(0,0)}, {Vec3(0.5f,-0.5f, 0.5f), Vec3(0,0,1), Vec2(1,0)},
        {Vec3(0.5f, 0.5f, 0.5f), Vec3(0,0,1), Vec2(1,1)}, {Vec3(-0.5f, 0.5f, 0.5f), Vec3(0,0,1), Vec2(0,1)},
        // Back
        {Vec3(-0.5f,-0.5f,-0.5f), Vec3(0,0,-1), Vec2(1,0)}, {Vec3(-0.5f, 0.5f,-0.5f), Vec3(0,0,-1), Vec2(1,1)},
        {Vec3(0.5f, 0.5f,-0.5f), Vec3(0,0,-1), Vec2(0,1)}, {Vec3(0.5f,-0.5f,-0.5f), Vec3(0,0,-1), Vec2(0,0)},
        // Top
        {Vec3(-0.5f, 0.5f,-0.5f), Vec3(0,1,0), Vec2(0,1)}, {Vec3(-0.5f, 0.5f, 0.5f), Vec3(0,1,0), Vec2(0,0)},
        {Vec3(0.5f, 0.5f, 0.5f), Vec3(0,1,0), Vec2(1,0)}, {Vec3(0.5f, 0.5f,-0.5f), Vec3(0,1,0), Vec2(1,1)},
        // Bottom
        {Vec3(-0.5f,-0.5f,-0.5f), Vec3(0,-1,0), Vec2(1,1)}, {Vec3(0.5f,-0.5f,-0.5f), Vec3(0,-1,0), Vec2(0,1)},
        {Vec3(0.5f,-0.5f, 0.5f), Vec3(0,-1,0), Vec2(0,0)}, {Vec3(-0.5f,-0.5f, 0.5f), Vec3(0,-1,0), Vec2(1,0)},
        // Right
        {Vec3(0.5f,-0.5f,-0.5f), Vec3(1,0,0), Vec2(1,0)}, {Vec3(0.5f, 0.5f,-0.5f), Vec3(1,0,0), Vec2(1,1)},
        {Vec3(0.5f, 0.5f, 0.5f), Vec3(1,0,0), Vec2(0,1)}, {Vec3(0.5f,-0.5f, 0.5f), Vec3(1,0,0), Vec2(0,0)},
        // Left
        {Vec3(-0.5f,-0.5f,-0.5f), Vec3(-1,0,0), Vec2(0,0)}, {Vec3(-0.5f,-0.5f, 0.5f), Vec3(-1,0,0), Vec2(1,0)},
        {Vec3(-0.5f, 0.5f, 0.5f), Vec3(-1,0,0), Vec2(1,1)}, {Vec3(-0.5f, 0.5f,-0.5f), Vec3(-1,0,0), Vec2(0,1)},
    };
    std::vector<GLuint> i = {
        0,1,2, 2,3,0, 4,5,6, 6,7,4, 8,9,10, 10,11,8,
        12,13,14, 14,15,12, 16,17,18, 18,19,16, 20,21,22, 22,23,20
    };
    return std::make_shared<Mesh>(v, i);
}

std::shared_ptr<Mesh> createPlane(int segments = 1) {
    std::vector<Vertex> v;
    std::vector<GLuint> idx;
    float step = 1.0f / segments;
    for (int z = 0; z <= segments; z++) {
        for (int x = 0; x <= segments; x++) {
            float px = x * step - 0.5f;
            float pz = z * step - 0.5f;
            v.push_back({Vec3(px, 0, pz), Vec3(0,1,0), Vec2(x * step, z * step)});
        }
    }
    for (int z = 0; z < segments; z++) {
        for (int x = 0; x < segments; x++) {
            int a = z * (segments + 1) + x;
            int b = a + 1;
            int c = a + segments + 1;
            int d = c + 1;
            idx.push_back(a); idx.push_back(c); idx.push_back(b);
            idx.push_back(b); idx.push_back(c); idx.push_back(d);
        }
    }
    return std::make_shared<Mesh>(v, idx);
}

// ============================================================================
// ████████  نظام الكاميرا (Camera System)  ████████
// ============================================================================
class Camera {
public:
    Vec3 position;
    Vec3 front, up, right, worldUp;
    float yaw = -90.0f, pitch = 0.0f;
    float moveSpeed = 4.0f;
    float mouseSensitivity = 0.12f;
    float fov = 60.0f;

    Camera(Vec3 pos = Vec3(0, 2, 5)) : position(pos), worldUp(Vec3(0, 1, 0)) {
        updateVectors();
    }
    Mat4 getView() { return Mat4::lookAt(position, position + front, up); }
    Mat4 getProjection(float aspect) { return Mat4::perspective(fov, aspect, 0.1f, 200.0f); }

    void processKeyboard(int dir, float dt) {
        float v = moveSpeed * dt;
        if (dir == 0) position = position + front * v;      // W
        if (dir == 1) position = position - front * v;      // S
        if (dir == 2) position = position - right * v;      // A
        if (dir == 3) position = position + right * v;      // D
        if (dir == 4) position.y += v;                      // Space
        if (dir == 5) position.y -= v;                      // Left Shift
    }
    void processMouse(float xoff, float yoff) {
        xoff *= mouseSensitivity;
        yoff *= mouseSensitivity;
        yaw   += xoff;
        pitch += yoff;
        if (pitch > 89.0f)  pitch = 89.0f;
        if (pitch < -89.0f) pitch = -89.0f;
        updateVectors();
    }
    void processScroll(float yoff) {
        fov -= yoff * 2.0f;
        if (fov < 10.0f) fov = 10.0f;
        if (fov > 90.0f) fov = 90.0f;
    }
private:
    void updateVectors() {
        Vec3 f;
        f.x = std::cos(yaw * 3.14159265f / 180.0f) * std::cos(pitch * 3.14159265f / 180.0f);
        f.y = std::sin(pitch * 3.14159265f / 180.0f);
        f.z = std::sin(yaw * 3.14159265f / 180.0f) * std::cos(pitch * 3.14159265f / 180.0f);
        front = f.normalize();
        right = front.cross(worldUp).normalize();
        up    = right.cross(front).normalize();
    }
};

// ============================================================================
// ████████  نظام الكيانات والمكونات (ECS)  ████████
// ============================================================================
struct Transform {
    Vec3 position;
    Vec3 rotation;
    Vec3 scale;
    Transform(Vec3 p = Vec3(), Vec3 r = Vec3(), Vec3 s = Vec3(1,1,1))
        : position(p), rotation(r), scale(s) {}
    Mat4 getMatrix() const {
        Mat4 t = Mat4::translate(position);
        Mat4 rx = Mat4::rotate(rotation.x, Vec3(1,0,0));
        Mat4 ry = Mat4::rotate(rotation.y, Vec3(0,1,0));
        Mat4 rz = Mat4::rotate(rotation.z, Vec3(0,0,1));
        Mat4 s = Mat4::scale(scale);
        return t * (ry * rx * rz) * s;
    }
};

struct Renderable {
    std::shared_ptr<Mesh> mesh;
    Vec3 color;
    float metallic = 0.0f;
    float roughness = 0.5f;
    Renderable(std::shared_ptr<Mesh> m, Vec3 c = Vec3(1,1,1)) : mesh(m), color(c) {}
};

struct Rotator {
    Vec3 speed;
    Rotator(Vec3 s = Vec3(0, 30, 0)) : speed(s) {}
};

class Entity {
public:
    std::string name;
    Transform transform;
    std::shared_ptr<Renderable> renderable;
    std::shared_ptr<Rotator> rotator;
    bool active = true;

    Entity(const std::string& n) : name(n) {}

    void update(float dt) {
        if (rotator) {
            transform.rotation = transform.rotation + rotator->speed * dt;
        }
    }
};

class Scene {
    std::vector<std::shared_ptr<Entity>> entities;
public:
    void add(std::shared_ptr<Entity> e) { entities.push_back(e); }
    const std::vector<std::shared_ptr<Entity>>& all() const { return entities; }
    void update(float dt) {
        for (auto& e : entities) if (e->active) e->update(dt);
    }
};

// ============================================================================
// ████████  نظام الرسم (Renderer)  ████████
// ============================================================================
class Renderer {
    Shader* shader;
public:
    Renderer(Shader* s) : shader(s) {}

    void begin(Camera& cam, float aspect, Vec3 lightPos, Vec3 lightColor, Vec3 ambient) {
        shader->use();
        shader->setMat4("projection", cam.getProjection(aspect));
        shader->setMat4("view", cam.getView());
        shader->setVec3("lightPos", lightPos);
        shader->setVec3("lightColor", lightColor);
        shader->setVec3("ambientColor", ambient);
        shader->setVec3("viewPos", cam.position);
    }

    void submit(Entity& e) {
        if (!e.renderable || !e.active) return;
        shader->setMat4("model", e.transform.getMatrix());
        shader->setVec3("objectColor", e.renderable->color);
        shader->setFloat("metallic", e.renderable->metallic);
        shader->setFloat("roughness", e.renderable->roughness);
        e.renderable->mesh->draw();
    }

    void render(Scene& scene, Camera& cam, float aspect, Vec3 lightPos, Vec3 lightColor, Vec3 ambient) {
        begin(cam, aspect, lightPos, lightColor, ambient);
        for (auto& e : scene.all()) submit(*e);
    }
};

// ============================================================================
// ████████  شفرات GLSL (Vertex & Fragment)  ████████
// ============================================================================
const char* vertexShaderSource = R"(
#version 330 core
layout (location = 0) in vec3 aPos;
layout (location = 1) in vec3 aNormal;
layout (location = 2) in vec2 aTexCoord;

out vec3 FragPos;
out vec3 Normal;
out vec2 TexCoord;

uniform mat4 model;
uniform mat4 view;
uniform mat4 projection;

void main() {
    FragPos = vec3(model * vec4(aPos, 1.0));
    Normal = mat3(transpose(inverse(model))) * aNormal;
    TexCoord = aTexCoord;
    gl_Position = projection * view * vec4(FragPos, 1.0);
}
)";

const char* fragmentShaderSource = R"(
#version 330 core
out vec4 FragColor;

in vec3 FragPos;
in vec3 Normal;
in vec2 TexCoord;

uniform vec3 objectColor;
uniform vec3 lightPos;
uniform vec3 lightColor;
uniform vec3 ambientColor;
uniform vec3 viewPos;
uniform float metallic;
uniform float roughness;

void main() {
    // Ambient
    vec3 ambient = ambientColor * lightColor * 0.3;

    // Diffuse
    vec3 norm = normalize(Normal);
    vec3 lightDir = normalize(lightPos - FragPos);
    float diff = max(dot(norm, lightDir), 0.0);
    vec3 diffuse = diff * lightColor;

    // Specular (Blinn-Phong)
    vec3 viewDir = normalize(viewPos - FragPos);
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(norm, halfDir), 0.0), 32.0 * (1.0 - roughness));
    vec3 specular = spec * lightColor * metallic;

    vec3 result = (ambient + diffuse + specular) * objectColor;

    // Fog
    float dist = length(viewPos - FragPos);
    float fogFactor = exp(-dist * 0.02);
    fogFactor = clamp(fogFactor, 0.0, 1.0);
    vec3 fogColor = vec3(0.1, 0.1, 0.15);
    result = mix(fogColor, result, fogFactor);

    FragColor = vec4(result, 1.0);
}
)";

// ============================================================================
// ████████  تطبيق المحرك (Application)  ████████
// ============================================================================
class Application {
    GLFWwindow* window = nullptr;
    int width, height;
    std::unique_ptr<Shader> shader;
    std::unique_ptr<Camera> camera;
    std::unique_ptr<Scene> scene;
    std::unique_ptr<Renderer> renderer;
    Time time;
    float lastX = 0, lastY = 0;
    bool firstMouse = true;
    bool wireframe = false;
    bool paused = false;

    // Light animation
    Vec3 lightPos;
    Vec3 lightColor;
    Vec3 ambientColor;

public:
    Application(int w, int h) : width(w), height(h) {}

    bool init() {
        Log::msg(Log::INFO, "جاري تهيئة المحرك...");

        if (!glfwInit()) {
            Log::msg(Log::ERROR, "فشل تهيئة GLFW!");
            return false;
        }

        glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
        glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
        glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
        glfwWindowHint(GLFW_SAMPLES, 4);  // Anti-aliasing

        window = glfwCreateWindow(width, height, "SovereignX Engine v1.0 | محرك SovereignX", nullptr, nullptr);
        if (!window) {
            Log::msg(Log::ERROR, "فشل إنشاء النافذة!");
            glfwTerminate();
            return false;
        }

        glfwMakeContextCurrent(window);
        glfwSetWindowUserPointer(window, this);
        glfwSetFramebufferSizeCallback(window, framebufferSizeCallback);
        glfwSetCursorPosCallback(window, mouseCallback);
        glfwSetScrollCallback(window, scrollCallback);
        glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_DISABLED);

        if (!gladLoadGLLoader((GLADloadproc)glfwGetProcAddress)) {
            Log::msg(Log::ERROR, "فشل تهيئة GLAD!");
            return false;
        }

        Log::msg(Log::INFO, std::string("OpenGL Version: ") + (const char*)glGetString(GL_VERSION));

        glEnable(GL_DEPTH_TEST);
        glEnable(GL_MULTISAMPLE);
        glEnable(GL_CULL_FACE);
        glCullFace(GL_BACK);
        glFrontFace(GL_CCW);

        shader = std::make_unique<Shader>(vertexShaderSource, fragmentShaderSource);
        camera = std::make_unique<Camera>(Vec3(0, 3, 8));
        scene = std::make_unique<Scene>();
        renderer = std::make_unique<Renderer>(shader.get());

        lightPos = Vec3(5, 8, 5);
        lightColor = Vec3(1.0f, 0.95f, 0.8f);
        ambientColor = Vec3(0.1f, 0.1f, 0.15f);

        buildScene();

        Log::msg(Log::INFO, "تم تهيئة المحرك بنجاح!");
        Log::msg(Log::INFO, "Controls: WASD - Move | Space/Shift - Up/Down | Mouse - Look | ESC - Exit | P - Pause | Tab - Wireframe");
        return true;
    }

    void buildScene() {
        auto cubeMesh = createCube();
        auto planeMesh = createPlane(20);

        // أرضية كبيرة
        auto ground = std::make_shared<Entity>("Ground");
        ground->transform.position = Vec3(0, -0.55f, 0);
        ground->transform.scale = Vec3(40, 1, 40);
        ground->renderable = std::make_shared<Renderable>(planeMesh, Vec3(0.15f, 0.18f, 0.22f));
        ground->renderable->roughness = 0.9f;
        scene->add(ground);

        // شبكة مكعبات
        for (int x = -3; x <= 3; x++) {
            for (int z = -3; z <= 3; z++) {
                if (x == 0 && z == 0) continue;
                auto box = std::make_shared<Entity>("Box_" + std::to_string(x) + "_" + std::to_string(z));
                box->transform.position = Vec3(x * 2.0f, 0.5f, z * 2.0f);
                box->transform.scale = Vec3(0.8f, 0.8f, 0.8f);

                // ألوان متنوعة
                float r = 0.3f + std::abs(std::sin(x * 0.7f)) * 0.7f;
                float g = 0.3f + std::abs(std::sin(z * 0.5f + 1)) * 0.7f;
                float b = 0.3f + std::abs(std::sin((x+z) * 0.3f + 2)) * 0.7f;
                box->renderable = std::make_shared<Renderable>(cubeMesh, Vec3(r, g, b));
                box->renderable->metallic = std::abs(std::sin(x*z*0.5f)) * 0.8f;
                box->renderable->roughness = 0.2f + std::abs(std::cos(x+z)) * 0.6f;

                // بعضها يدور
                if ((x + z) % 3 == 0) {
                    box->rotator = std::make_shared<Rotator>(Vec3(0, 45 + x * 10, 0));
                }
                scene->add(box);
            }
        }

        // مكعب مركزي كبير
        auto center = std::make_shared<Entity>("CenterPiece");
        center->transform.position = Vec3(0, 1.5f, 0);
        center->transform.scale = Vec3(1.5f, 1.5f, 1.5f);
        center->renderable = std::make_shared<Renderable>(cubeMesh, Vec3(0.9f, 0.2f, 0.2f));
        center->renderable->metallic = 0.8f;
        center->renderable->roughness = 0.2f;
        center->rotator = std::make_shared<Rotator>(Vec3(20, 40, 10));
        scene->add(center);

        // أعمدة
        for (int i = 0; i < 8; i++) {
            float angle = i * 3.14159265f * 2.0f / 8.0f;
            float radius = 7.0f;
            auto pillar = std::make_shared<Entity>("Pillar_" + std::to_string(i));
            pillar->transform.position = Vec3(std::cos(angle)*radius, 2.0f, std::sin(angle)*radius);
            pillar->transform.scale = Vec3(0.4f, 4.0f, 0.4f);
            pillar->renderable = std::make_shared<Renderable>(cubeMesh, Vec3(0.6f, 0.6f, 0.65f));
            pillar->renderable->roughness = 0.3f;
            pillar->renderable->metallic = 0.1f;
            scene->add(pillar);
        }
    }

    void run() {
        while (!glfwWindowShouldClose(window)) {
            time.update();

            processInput();

            if (!paused) {
                scene->update(time.deltaTime);

                // تحريك الضوء
                float t = time.totalTime;
                lightPos.x = std::sin(t * 0.5f) * 10.0f;
                lightPos.z = std::cos(t * 0.5f) * 10.0f;
                lightPos.y = 6.0f + std::sin(t * 0.3f) * 2.0f;
            }

            // Clear
            glClearColor(0.05f, 0.05f, 0.08f, 1.0f);
            glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

            // Render
            float aspect = (float)width / (float)height;
            renderer->render(*scene, *camera, aspect, lightPos, lightColor, ambientColor);

            glfwSwapBuffers(window);
            glfwPollEvents();
        }
    }

    void processInput() {
        // Exit
        if (glfwGetKey(window, GLFW_KEY_ESCAPE) == GLFW_PRESS)
            glfwSetWindowShouldClose(window, true);

        // Pause
        static bool pPressed = false;
        if (glfwGetKey(window, GLFW_KEY_P) == GLFW_PRESS) {
            if (!pPressed) { paused = !paused; pPressed = true; }
        } else { pPressed = false; }

        // Wireframe toggle
        static bool tabPressed = false;
        if (glfwGetKey(window, GLFW_KEY_TAB) == GLFW_PRESS) {
            if (!tabPressed) {
                wireframe = !wireframe;
                glPolygonMode(GL_FRONT_AND_BACK, wireframe ? GL_LINE : GL_FILL);
                tabPressed = true;
            }
        } else { tabPressed = false; }

        if (paused) return;

        // Movement
        if (glfwGetKey(window, GLFW_KEY_W) == GLFW_PRESS) camera->processKeyboard(0, time.deltaTime);
        if (glfwGetKey(window, GLFW_KEY_S) == GLFW_PRESS) camera->processKeyboard(1, time.deltaTime);
        if (glfwGetKey(window, GLFW_KEY_A) == GLFW_PRESS) camera->processKeyboard(2, time.deltaTime);
        if (glfwGetKey(window, GLFW_KEY_D) == GLFW_PRESS) camera->processKeyboard(3, time.deltaTime);
        if (glfwGetKey(window, GLFW_KEY_SPACE) == GLFW_PRESS) camera->processKeyboard(4, time.deltaTime);
        if (glfwGetKey(window, GLFW_KEY_LEFT_SHIFT) == GLFW_PRESS) camera->processKeyboard(5, time.deltaTime);

        // Speed boost
        if (glfwGetKey(window, GLFW_KEY_LEFT_CONTROL) == GLFW_PRESS)
            camera->moveSpeed = 10.0f;
        else
            camera->moveSpeed = 4.0f;
    }

    static void framebufferSizeCallback(GLFWwindow* w, int width, int height) {
        glViewport(0, 0, width, height);
        auto app = static_cast<Application*>(glfwGetWindowUserPointer(w));
        app->width = width; app->height = height;
    }

    static void mouseCallback(GLFWwindow* w, double x, double y) {
        auto app = static_cast<Application*>(glfwGetWindowUserPointer(w));
        if (app->firstMouse) {
            app->lastX = (float)x; app->lastY = (float)y;
            app->firstMouse = false;
        }
        float xoff = (float)x - app->lastX;
        float yoff = app->lastY - (float)y;
        app->lastX = (float)x; app->lastY = (float)y;
        if (!app->paused) app->camera->processMouse(xoff, yoff);
    }

    static void scrollCallback(GLFWwindow* w, double x, double y) {
        auto app = static_cast<Application*>(glfwGetWindowUserPointer(w));
        app->camera->processScroll((float)y);
    }

    ~Application() {
        Log::msg(Log::INFO, "جاري إغلاق المحرك...");
        glfwTerminate();
    }
};

// ============================================================================
// ████████  الدالة الرئيسية (Main Entry Point)  ████████
// ============================================================================
int main() {
    std::cout << "\n";
    std::cout << "  ╔═══════════════════════════════════════════════════════════════╗\n";
    std::cout << "  ║         SovereignX Mini Game Engine v1.0                      ║\n";
    std::cout << "  ║         محرك ألعاب SovereignX المصغر                        ║\n";
    std::cout << "  ╚═══════════════════════════════════════════════════════════════╝\n\n";

    Application app(1280, 720);
    if (!app.init()) {
        Log::msg(Log::ERROR, "فشل تشغيل المحرك!");
        return -1;
    }

    app.run();
    return 0;
}